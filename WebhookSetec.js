const express = require('express');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY;
const API_URL = process.env.API_URL;

// Almacenar los logs en memoria (para simplicidad; en producción considerar otros métodos)
const logs = [];

// Endpoint para servir el archivo HTML
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

// Endpoint para enviar logs usando SSE
app.get('/logs', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    logs.forEach(log => res.write(`data: ${log}\n\n`)); // Enviar logs anteriores

    // Función para enviar nuevos logs
    const sendLog = (log) => res.write(`data: ${log}\n\n`);

    // Agregar función a un arreglo para que pueda ser llamada más tarde
    logListeners.push(sendLog);

    req.on('close', () => {
        // Eliminar la función cuando la conexión se cierra
        logListeners = logListeners.filter(listener => listener !== sendLog);
    });
});

let logListeners = [];

const addLog = (log) => {
    logs.push(log);
    if (logs.length > 100) logs.shift();
    logListeners.forEach(listener => listener(log));
};

const targetBoardId = 1476500931;  // ID du tableau CONSO SETEC

app.post('/', async (req, res) => {
    const log = `Webhook reçu: ${JSON.stringify(req.body, null, 2)}`;
    console.log(log);
    addLog(log);

    if (req.body.challenge) {
        console.log("Répondre au challenge du webhook");
        return res.status(200).json({ challenge: req.body.challenge });
    }

    if (req.body.event) {
        const { pulseName, columnId, value, columnType } = req.body.event;
        const log = `Handling column update: pulseName=${pulseName}, columnId=${columnId}, columnType=${columnType}, value=${JSON.stringify(value)}`;
        console.log(log);
        addLog(log);

        const itemId = await findItemByName(targetBoardId, pulseName);
        if (itemId) {
            console.log(`Élément trouvé, ID: ${itemId}, mise à jour de la colonne.`);
            addLog(`Élément trouvé, ID: ${itemId}, mise à jour de la colonne.`);
            if (columnType === "color") {
                await updateStatusColumn(targetBoardId, itemId, columnId, value);
            } else if (columnType === "dropdown") {
                await updateDropdownColumn(targetBoardId, itemId, columnId, value);
            } else if (columnType === "numeric") {
                await updateNumberColumn(targetBoardId, itemId, columnId, value);
            } else if (columnType === "timerange") {
                await updateTimelineColumn(targetBoardId, itemId, columnId, value);
            } else if (columnType === "long-text") {
                await updateLongTextColumn(targetBoardId, itemId, columnId, value);
            } else if (columnType === "multiple-person") {
                await updatePeopleColumn(targetBoardId, itemId, columnId, value);
            } else {
                await updateTextColumn(targetBoardId, itemId, columnId, value);
            }
        } else {
            console.log(`Aucun élément trouvé avec le nom '${pulseName}' à mettre à jour.`);
            addLog(`Aucun élément trouvé avec le nom '${pulseName}' à mettre à jour.`);
        }
    }
    res.status(200).send('Webhook traité');
});


async function findItemByName(boardId, itemName) {
    const query = JSON.stringify({
        query: `
            query {
                items_page_by_column_values (board_id: ${boardId}, columns: [{column_id: "name", column_values: ["${itemName}"]}]) {
                    items {
                        id
                        name
                    }
                }
            }
        `
    });

    const config = {
        method: 'post',
        url: API_URL,
        headers: {
            'Authorization': API_KEY,
            'Content-Type': 'application/json'
        },
        data: query
    };

    try {
        const response = await axios(config);
        console.log("Réponse de la recherche d'éléments:", JSON.stringify(response.data));
        if (response.data.data && response.data.data.items_page_by_column_values && response.data.data.items_page_by_column_values.items.length > 0) {
            return response.data.data.items_page_by_column_values.items[0].id;  // Retourne l'ID du premier élément correspondant
        } else {
            console.log("Aucun élément trouvé avec ce nom:", itemName);
            return null;
        }
    } catch (error) {
        console.error("Erreur lors de la recherche de l'élément par nom:", error);
        return null;
    }
}

async function updateTextColumn(boardId, itemId, columnId, value) {
    let formattedValue = '""'; // Valeur par défaut si la valeur est indéfinie ou nulle

    if (value && value.value !== undefined && typeof value.value === 'string') {
        formattedValue = `"${value.value.replace(/"/g, '\\"')}"`;
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
            'Authorization': API_KEY,
            'Content-Type': 'application/json'
        },
        data: JSON.stringify({ query: mutation })
    };

    try {
        const response = await axios(config);
        if (response.data.errors) {
            console.error("Erreur dans l'API:", JSON.stringify(response.data.errors));
        } else {
            console.log("Colonne de texte mise à jour avec succès:", JSON.stringify(response.data));
        }
    } catch (error) {
        console.error("Erreur lors de la mise à jour de la colonne de texte:", JSON.stringify(error.response ? error.response.data : error.message));
    }
}

async function updateStatusColumn(boardId, itemId, columnId, value) {
    let formattedValue = '{}'; // Valeur par défaut si la valeur est indéfinie ou nulle

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
            'Authorization': API_KEY,
            'Content-Type': 'application/json'
        },
        data: JSON.stringify({ query: mutation })
    };

    try {
        const response = await axios(config);
        if (response.data.errors) {
            console.error("Erreur dans l'API:", JSON.stringify(response.data.errors));
        } else {
            console.log("Colonne de statut mise à jour avec succès:", JSON.stringify(response.data));
        }
    } catch (error) {
        console.error("Erreur lors de la mise à jour de la colonne de statut:", JSON.stringify(error.response ? error.response.data : error.message));
    }
}

async function updateDropdownColumn(boardId, itemId, columnId, value) {
    let formattedValue = '""'; // Valeur par défaut si la valeur est indéfinie ou nulle

    if (value && value.chosenValues && value.chosenValues.length > 0) {
        const chosenValuesText = value.chosenValues.map(v => v.name).join(", ");
        formattedValue = `"${chosenValuesText.replace(/"/g, '\\"')}"`;
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
            'Authorization': API_KEY,
            'Content-Type': 'application/json'
        },
        data: JSON.stringify({ query: mutation })
    };

    try {
        const response = await axios(config);
        if (response.data.errors) {
            console.error("Erreur dans l'API:", JSON.stringify(response.data.errors));
        } else {
            console.log("Colonne de dropdown mise à jour avec succès:", JSON.stringify(response.data));
        }
    } catch (error) {
        console.error("Erreur lors de la mise à jour de la colonne de dropdown:", JSON.stringify(error.response ? error.response.data : error.message));
    }
}

async function updateNumberColumn(boardId, itemId, columnId, value) {
    let formattedValue;

    if (value && value.value !== undefined) {
        // Si el valor no es null, lo formateamos adecuadamente
        formattedValue = value.value !== null ? `${value.value}` : 'null';
    } else {
        formattedValue = 'null'; // Valor por defecto si la columna está vacía
    }

    // Construcción de la mutación
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
            'Authorization': API_KEY,
            'Content-Type': 'application/json'
        },
        data: JSON.stringify({ query: mutation })
    };

    try {
        const response = await axios(config);
        if (response.data.errors) {
            console.error("Erreur dans l'API:", JSON.stringify(response.data.errors));
        } else {
            console.log("Colonne de chiffres mise à jour avec succès:", JSON.stringify(response.data));
        }
    } catch (error) {
        console.error("Erreur lors de la mise à jour de la colonne de chiffres:", JSON.stringify(error.response ? error.response.data : error.message));
    }
}




async function updateTimelineColumn(boardId, itemId, columnId, value) {
    let formattedValue = '{}'; // Valeur par défaut si la valeur est indéfinie ou nulle

    if (value && value.from && value.to) {
        formattedValue = JSON.stringify({ [columnId]: { from: value.from, to: value.to } });
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
            'Authorization': API_KEY,
            'Content-Type': 'application/json'
        },
        data: JSON.stringify({ query: mutation })
    };

    try {
        const response = await axios(config);
        if (response.data.errors) {
            console.error("Erreur dans l'API:", JSON.stringify(response.data.errors));
        } else {
            console.log("Colonne de timeline mise à jour avec succès:", JSON.stringify(response.data));
        }
    } catch (error) {
        console.error("Erreur lors de la mise à jour de la colonne de timeline:", JSON.stringify(error.response ? error.response.data : error.message));
    }
}

async function updateLongTextColumn(boardId, itemId, columnId, value) {
    let formattedValue = '{}'; // Valor por defecto si la columna está vacía

    if (value && value.text !== undefined) {
        formattedValue = JSON.stringify({ [columnId]: { text: value.text || "" } });
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
            'Authorization': API_KEY,
            'Content-Type': 'application/json'
        },
        data: JSON.stringify({ query: mutation })
    };

    try {
        const response = await axios(config);
        if (response.data.errors) {
            console.error("Erreur dans l'API:", JSON.stringify(response.data.errors));
        } else {
            console.log("Colonne de long texte mise à jour avec succès:", JSON.stringify(response.data));
        }
    } catch (error) {
        console.error("Erreur lors de la mise à jour de la colonne de long texte:", JSON.stringify(error.response ? error.response.data : error.message));
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
        // Clear all people from the column
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
            'Authorization': API_KEY,
            'Content-Type': 'application/json'
        },
        data: JSON.stringify({ query: mutation })
    };

    try {
        const response = await axios(config);
        if (response.data.errors) {
            console.error("Erreur dans l'API:", JSON.stringify(response.data.errors));
        } else {
            console.log("Colonne de personnes mise à jour avec succès:", JSON.stringify(response.data));
        }
    } catch (error) {
        console.error("Erreur lors de la mise à jour de la colonne de personnes:", JSON.stringify(error.response ? error.response.data : error.message));
    }
}


app.listen(PORT, () => {
    console.log(`Serveur à l'écoute sur le port ${PORT}`);
});