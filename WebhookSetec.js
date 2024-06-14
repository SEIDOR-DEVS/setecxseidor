const express = require('express');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY;
const API_URL = process.env.API_URL;

const boardIds = [1476500931, 1533509999, 1439834379, 1467379370, 1468634352, 1468634852, 1468635523, 1468636303, 1468621303, 1468621814, 1468623121, 1468625512, 1468607663, 1468633309 ];  // IDs de los tableros

if (!API_KEY || !API_URL) {
    console.error("API_KEY or API_URL is not defined in the environment variables.");
    process.exit(1);
}

const logs = [];
let requestCount = 0;

const trackRequest = async (config) => {
    requestCount++;
    return axios(config);
};

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

app.get('/logs', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    logs.forEach(log => res.write(`data: ${log}\n\n`));

    const sendLog = (log) => res.write(`data: ${log}\n\n`);

    logListeners.push(sendLog);

    req.on('close', () => {
        logListeners = logListeners.filter(listener => listener !== sendLog);
    });
});

let logListeners = [];

const addLog = (log) => {
    let formattedLog = log;

    if (typeof log === 'object') {
        formattedLog = JSON.stringify(log, null, 2);
    }

    formattedLog = formattedLog
        .replace(/\n/g, '<br>')
        .replace(/  /g, '&nbsp;&nbsp;')
        .replace(/\\n/g, '<br>');

    logs.push(formattedLog);
    if (logs.length > 100) logs.shift();
    logListeners.forEach(listener => listener(formattedLog));
};

app.get('/request-count', (req, res) => {
    res.status(200).send(`
        <html>
        <body>
            <p>Request Count: ${requestCount}</p>
            <form action="/reset-count" method="POST">
                <button type="submit">Reset Count</button>
            </form>
        </body>
        </html>
    `);
});

app.post('/reset-count', (req, res) => {
    requestCount = 0;
    res.redirect('/request-count');
});

app.post('/', async (req, res) => {
    if (req.body.challenge) {
        console.log("Répondre au challenge du webhook");
        return res.status(200).json({ challenge: req.body.challenge });
    }

    const log = {
        event: req.body.event,
        message: `Handling event: type=${req.body.event.type}, itemName=${req.body.event.pulseName || req.body.event.itemName}, itemId=${req.body.event.pulseId || req.body.event.itemId}, boardId=${req.body.event.boardId}`
    };
    console.log(log);
    addLog(`Webhook reçu: ${JSON.stringify(req.body, null, 2)}`);
    addLog(log.message);

    if (req.body.event) {
        const { type, pulseName, pulseId, itemName, itemId, boardId, columnId, value, columnType } = req.body.event;
        const actualItemName = pulseName || itemName;
        const actualItemId = pulseId || itemId;

        const log = `Handling event: type=${type}, itemName=${actualItemName}, itemId=${actualItemId}, boardId=${boardId}`;
        console.log(log);
        addLog(log);

        if (!actualItemName) {
            console.log('itemName or pulseName is undefined');
            addLog('itemName or pulseName is undefined');
            return res.status(400).send('itemName or pulseName is undefined');
        }

        if (type === 'delete_pulse') {
            console.log(`Item deleted: ID=${actualItemId}, Name=${actualItemName}, BoardID=${boardId}`);
            addLog(`Item deleted: ID=${actualItemId}, Name=${actualItemName}, BoardID=${boardId}`);

            // Find and delete items with the same name in other boards
            const itemIds = await findItemByName(boardIds, actualItemName);
            await Promise.all(itemIds.map(async item => {
                if (item) {
                    console.log(`Élément trouvé pour suppression, ID: ${item.id}, BoardID: ${item.boardId}`);
                    addLog(`Élément trouvé pour suppression, ID: ${item.id}, BoardID: ${item.boardId}`);
                    await deleteItem(item.id);
                }
            }));
        } else {
            const itemIds = await findItemByName(boardIds, actualItemName);
            await Promise.all(itemIds.map(async item => {
                if (item) {
                    console.log(`Élément trouvé, ID: ${item.id}, mise à jour de la colonne.`);
                    addLog(`Élément trouvé, ID: ${item.id}, mise à jour de la colonne.`);
                    switch (columnType) {
                        case "color":
                            await updateStatusColumn(item.boardId, item.id, columnId, value);
                            break;
                        case "dropdown":
                            await updateDropdownColumn(item.boardId, item.id, columnId, value);
                            break;
                        case "numeric":
                            await updateNumberColumn(item.boardId, item.id, columnId, value);
                            break;
                        case "timerange":
                            await updateTimelineColumn(item.boardId, item.id, columnId, value);
                            break;
                        case "long-text":
                            await updateLongTextColumn(item.boardId, item.id, columnId, value);
                            break;
                        case "multiple-person":
                            await updatePeopleColumn(item.boardId, item.id, columnId, value);
                            break;
                        default:
                            await updateTextColumn(item.boardId, item.id, columnId, value);
                    }
                } else {
                    console.log(`Aucun élément trouvé avec le nom '${actualItemName}' à mettre à jour.`);
                    addLog(`Aucun élément trouvé avec le nom '${actualItemName}' à mettre à jour.`);
                }
            }));
        }
    }
    res.status(200).send('Webhook traité');
});


async function findItemByName(boardIds, itemName) {
    if (!itemName) {
        throw new Error("itemName is undefined");
    }

    const escapedItemName = itemName.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const items = await Promise.all(boardIds.map(async boardId => {
        const query = JSON.stringify({
            query: `
                query {
                    boards(ids: ${boardId}) {
                        items_page(limit: 100) {
                            items {
                                id
                                name
                            }
                        }
                    }
                }
            `
        });

        const config = {
            method: 'post',
            url: API_URL,
            headers: {
                'Authorization': `Bearer ${API_KEY}`,
                'Content-Type': 'application/json'
            },
            data: query
        };

        try {
            const response = await trackRequest(config);
            console.log("Réponse de la recherche d'éléments:", JSON.stringify(response.data, null, 2));
            addLog(`Réponse de la recherche d'éléments: ${JSON.stringify(response.data, null, 2)}`);
            if (response.data.data && response.data.data.boards[0].items_page.items.length > 0) {
                const items = response.data.data.boards[0].items_page.items;
                for (const item of items) {
                    if (item.name === itemName) {  // Comparación directa sin escapado
                        return { boardId, id: item.id };
                    }
                }
            } else {
                console.log(`Aucun élément trouvé avec ce nom: ${itemName} dans le tableau ${boardId}`);
            }
        } catch (error) {
            console.error("Erreur lors de la recherche de l'élément par nom:", error);
            addLog(`Erreur lors de la recherche de l'élément par nom: ${error}`);
        }
        return null;
    }));
    return items.filter(item => item !== null);
}

async function updateTextColumn(boardId, itemId, columnId, value) {
    let formattedValue = '""';

    if (value && value.value !== undefined && typeof value.value === 'string') {
        formattedValue = `"${value.value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
    }

    const mutation = `
        mutation {
            change_simple_column_value(board_id: ${boardId}, item_id: ${itemId}, column_id: "${columnId}", value: ${formattedValue}) {
                id
            }
        }
    `;

    const config = {
        method: 'post',
        url: API_URL,
        headers: {
            'Authorization': `Bearer ${API_KEY}`,
            'Content-Type': 'application/json'
        },
        data: JSON.stringify({ query: mutation })
    };

    try {
        const response = await trackRequest(config);
        if (response.data.errors) {
            console.error("Erreur dans l'API:", JSON.stringify(response.data.errors));
            addLog(`Erreur dans l'API: ${JSON.stringify(response.data.errors)}`);
        } else {
            console.log("Colonne de texte mise à jour avec succès:", JSON.stringify(response.data));
            addLog(`Colonne de texte mise à jour avec succès: ${JSON.stringify(response.data)}`);
        }
    } catch (error) {
        console.error("Erreur lors de la mise à jour de la colonne de texte:", JSON.stringify(error.response ? error.response.data : error.message));
        addLog(`Erreur lors de la mise à jour de la colonne de texte: ${JSON.stringify(error.response ? error.response.data : error.message)}`);
    }
}

async function updateStatusColumn(boardId, itemId, columnId, value) {
    let formattedValue = '{}';

    if (value && value.label && value.label.text !== undefined) {
        formattedValue = JSON.stringify({ [columnId]: { label: value.label.text } });
    }

    const mutation = `
        mutation {
            change_multiple_column_values(board_id: ${boardId}, item_id: ${itemId}, column_values: "${formattedValue.replace(/"/g, '\\"')}" ) {
                id
            }
        }
    `;

    const config = {
        method: 'post',
        url: API_URL,
        headers: {
            'Authorization': `Bearer ${API_KEY}`,
            'Content-Type': 'application/json'
        },
        data: JSON.stringify({ query: mutation })
    };

    try {
        const response = await trackRequest(config);
        if (response.data.errors) {
            console.error("Erreur dans l'API:", JSON.stringify(response.data.errors));
            addLog(`Erreur dans l'API: ${JSON.stringify(response.data.errors)}`);
        } else {
            console.log("Colonne de statut mise à jour avec succès:", JSON.stringify(response.data));
            addLog(`Colonne de statut mise à jour avec succès: ${JSON.stringify(response.data)}`);
        }
    } catch (error) {
        console.error("Erreur lors de la mise à jour de la colonne de statut:", JSON.stringify(error.response ? error.response.data : error.message));
        addLog(`Erreur lors de la mise à jour de la colonne de statut: ${JSON.stringify(error.response ? error.response.data : error.message)}`);
    }
}

async function updateDropdownColumn(boardId, itemId, columnId, value) {
    let formattedValue = '""';

    if (value && value.chosenValues && value.chosenValues.length > 0) {
        const chosenValuesText = value.chosenValues.map(v => v.name).join(", ");
        formattedValue = `"${chosenValuesText.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
    }

    const mutation = `
        mutation {
            change_simple_column_value(board_id: ${boardId}, item_id: ${itemId}, column_id: "${columnId}", value: ${formattedValue}, create_labels_if_missing: true) {
                id
            }
        }
    `;

    const config = {
        method: 'post',
        url: API_URL,
        headers: {
            'Authorization': `Bearer ${API_KEY}`,
            'Content-Type': 'application/json'
        },
        data: JSON.stringify({ query: mutation })
    };

    try {
        const response = await trackRequest(config);
        if (response.data.errors) {
            console.error("Erreur dans l'API:", JSON.stringify(response.data.errors));
            addLog(`Erreur dans l'API: ${JSON.stringify(response.data.errors)}`);
        } else {
            console.log("Colonne de dropdown mise à jour avec succès:", JSON.stringify(response.data));
            addLog(`Colonne de dropdown mise à jour avec succès: ${JSON.stringify(response.data)}`);
        }
    } catch (error) {
        console.error("Erreur lors de la mise à jour de la colonne de dropdown:", JSON.stringify(error.response ? error.response.data : error.message));
        addLog(`Erreur lors de la mise à jour de la colonne de dropdown: ${JSON.stringify(error.response ? error.response.data : error.message)}`);
    }
}

async function updateNumberColumn(boardId, itemId, columnId, value) {
    let formattedValue;

    if (value && value.value !== undefined) {
        formattedValue = value.value !== null ? `${value.value}` : 'null';
    } else {
        formattedValue = 'null';
    }

    const mutation = `
        mutation {
            change_multiple_column_values(board_id: ${boardId}, item_id: ${itemId}, column_values: "{\\"${columnId}\\": ${formattedValue}}" ) {
                id
            }
        }
    `;

    const config = {
        method: 'post',
        url: API_URL,
        headers: {
            'Authorization': `Bearer ${API_KEY}`,
            'Content-Type': 'application/json'
        },
        data: JSON.stringify({ query: mutation })
    };

    try {
        const response = await trackRequest(config);
        if (response.data.errors) {
            console.error("Erreur dans l'API:", JSON.stringify(response.data.errors));
            addLog(`Erreur dans l'API: ${JSON.stringify(response.data.errors)}`);
        } else {
            console.log("Colonne de chiffres mise à jour avec succès:", JSON.stringify(response.data));
            addLog(`Colonne de chiffres mise à jour avec succès: ${JSON.stringify(response.data)}`);
        }
    } catch (error) {
        console.error("Erreur lors de la mise à jour de la colonne de chiffres:", JSON.stringify(error.response ? error.response.data : error.message));
        addLog(`Erreur lors de la mise à jour de la colonne de chiffres: ${JSON.stringify(error.response ? error.response.data : error.message)}`);
    }
}

async function updateTimelineColumn(boardId, itemId, columnId, value) {
    let mutation;

    if (value && value.from && value.to) {
        const formattedValue = JSON.stringify({ [columnId]: { from: value.from, to: value.to } }).replace(/"/g, '\\"');
        console.log(`Formatted value for timeline column ${columnId}:`, formattedValue);
        mutation = `
            mutation {
                change_multiple_column_values(board_id: ${boardId}, item_id: ${itemId}, column_values: "{\\"${columnId}\\": {\\"from\\": \\"${value.from}\\", \\"to\\": \\"${value.to}\\"}}" ) {
                    id
                }
            }
        `;
    } else {
        mutation = `
            mutation {
                change_multiple_column_values(board_id: ${boardId}, item_id: ${itemId}, column_values: "{\\"${columnId}\\": null}" ) {
                    id
                }
            }
        `;
    }

    const config = {
        method: 'post',
        url: API_URL,
        headers: {
            'Authorization': `Bearer ${API_KEY}`,
            'Content-Type': 'application/json'
        },
        data: JSON.stringify({ query: mutation })
    };

    try {
        const response = await trackRequest(config);
        if (response.data.errors) {
            console.error("Erreur dans l'API:", JSON.stringify(response.data.errors));
            addLog(`Erreur dans l'API: ${JSON.stringify(response.data.errors)}`);
        } else {
            console.log("Colonne de timeline mise à jour avec succès:", JSON.stringify(response.data));
            addLog(`Colonne de timeline mise à jour avec succès: ${JSON.stringify(response.data)}`);
        }
    } catch (error) {
        console.error("Erreur lors de la mise à jour de la colonne de timeline:", JSON.stringify(error.response ? error.response.data : error.message));
        addLog(`Erreur lors de la mise à jour de la colonne de timeline: ${JSON.stringify(error.response ? error.response.data : error.message)}`);
    }
}

async function updateLongTextColumn(boardId, itemId, columnId, value) {
    let formattedValue = '{}';

    if (value && value.text !== undefined) {
        // Reemplazar saltos de línea con \\n para mantenerlos en la API
        const textWithEscapedNewLines = value.text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
        formattedValue = JSON.stringify({ [columnId]: { text: textWithEscapedNewLines } });
    }

    console.log(`Formatted value for long text column ${columnId}:`, formattedValue);

    const mutation = `
        mutation {
            change_multiple_column_values(board_id: ${boardId}, item_id: ${itemId}, column_values: "${formattedValue.replace(/"/g, '\\"')}" ) {
                id
            }
        }
    `;

    const config = {
        method: 'post',
        url: API_URL,
        headers: {
            'Authorization': `Bearer ${API_KEY}`,
            'Content-Type': 'application/json'
        },
        data: JSON.stringify({ query: mutation })
    };

    try {
        const response = await trackRequest(config);
        if (response.data.errors) {
            console.error("Erreur dans l'API:", JSON.stringify(response.data.errors));
            addLog(`Erreur dans l'API: ${JSON.stringify(response.data.errors)}`);
        } else {
            console.log("Colonne de long texte mise à jour avec succès:", JSON.stringify(response.data));
            addLog(`Colonne de long texte mise à jour avec succès: ${JSON.stringify(response.data)}`);
        }
    } catch (error) {
        console.error("Erreur lors de la mise à jour de la colonne de long texte:", JSON.stringify(error.response ? error.response.data : error.message));
        addLog(`Erreur lors de la mise à jour de la colonne de long texte: ${JSON.stringify(error.response ? error.response.data : error.message)}`);
    }
}

async function updatePeopleColumn(boardId, itemId, columnId, value) {
    let mutation;

    if (value && value.personsAndTeams && value.personsAndTeams.length > 0) {
        const formattedValue = JSON.stringify({ personsAndTeams: value.personsAndTeams });
        console.log(`Formatted value for people column ${columnId}:`, formattedValue);
        mutation = `
            mutation {
                change_multiple_column_values(board_id: ${boardId}, item_id: ${itemId}, column_values: "${JSON.stringify({ [columnId]: { personsAndTeams: value.personsAndTeams } }).replace(/"/g, '\\"')}" ) {
                    id
                }
            }
        `;
    } else {
        mutation = `
            mutation {
                change_column_value(board_id: ${boardId}, item_id: ${itemId}, column_id: "${columnId}", value: "{\\"clear_all\\":true}") {
                    id
                }
            }
        `;
    }

    const config = {
        method: 'post',
        url: API_URL,
        headers: {
            'Authorization': `Bearer ${API_KEY}`,
            'Content-Type': 'application/json'
        },
        data: JSON.stringify({ query: mutation })
    };

    try {
        const response = await trackRequest(config);
        if (response.data.errors) {
            console.error("Erreur dans l'API:", JSON.stringify(response.data.errors));
            addLog(`Erreur dans l'API: ${JSON.stringify(response.data.errors)}`);
        } else {
            console.log("Colonne de personnes mise à jour avec succès:", JSON.stringify(response.data));
            addLog(`Colonne de personnes mise à jour avec succès: ${JSON.stringify(response.data)}`);
        }
    } catch (error) {
        console.error("Erreur lors de la mise à jour de la colonne de personnes:", JSON.stringify(error.response ? error.response.data : error.message));
        addLog(`Erreur lors de la mise à jour de la colonne de personnes: ${JSON.stringify(error.response ? error.response.data : error.message)}`);
    }
}

async function deleteItem(itemId) {
    const mutation = `
        mutation {
            delete_item(item_id: ${itemId}) {
                id
            }
        }
    `;

    const config = {
        method: 'post',
        url: API_URL,
        headers: {
            'Authorization': `Bearer ${API_KEY}`,
            'Content-Type': 'application/json'
        },
        data: JSON.stringify({ query: mutation })
    };

    try {
        const response = await trackRequest(config);
        if (response.data.errors) {
            console.error("Erreur dans l'API:", JSON.stringify(response.data.errors));
            addLog(`Erreur dans l'API: ${JSON.stringify(response.data.errors)}`);
        } else {
            console.log("Item supprimé avec succès:", JSON.stringify(response.data));
            addLog(`Item supprimé avec succès: ${JSON.stringify(response.data)}`);
        }
    } catch (error) {
        console.error("Erreur lors de la suppression de l'item:", JSON.stringify(error.response ? error.response.data : error.message));
        addLog(`Erreur lors de la suppression de l'item: ${JSON.stringify(error.response ? error.response.data : error.message)}`);
    }
}




app.listen(PORT, () => {
    console.log(`Serveur à l'écoute sur le port ${PORT}`);
});
