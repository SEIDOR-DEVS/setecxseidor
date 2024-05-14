const express = require('express');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY;
const API_URL = process.env.API_URL;

const targetBoardId = 6585828609;  // ID du tableau cible

app.post('/', async (req, res) => {
    console.log("Webhook reçu:", JSON.stringify(req.body, null, 2));

    // Vérifier si le corps de la requête contient un champ challenge
    if (req.body.challenge) {
        console.log("Répondre au challenge du webhook");
        return res.status(200).json({ challenge: req.body.challenge });
    }

    if (req.body.event) {
        const { pulseName, columnId, value, columnType } = req.body.event;

        const itemId = await findItemByName(targetBoardId, pulseName);
        if (itemId) {
            console.log(`Élément trouvé, ID: ${itemId}, mise à jour de la colonne.`);
            if (columnType === "color") {
                await updateStatusColumn(targetBoardId, itemId, columnId, value);
            } else if (columnType === "dropdown") {
                await updateDropdownColumn(targetBoardId, itemId, columnId, value);
            } else if (columnType === "numeric") {
                await updateNumberColumn(targetBoardId, itemId, columnId, value);
            } else {
                await updateTextColumn(targetBoardId, itemId, columnId, value);
            }
        } else {
            console.log(`Aucun élément trouvé avec le nom '${pulseName}' à mettre à jour.`);
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
    let formattedValue = '""'; // Valeur par défaut si la valeur est indéfinie ou nulle

    if (value && value.value !== undefined && typeof value.value === 'number') {
        formattedValue = `${value.value}`;
    }

    const mutation = `
        mutation {
            change_multiple_column_values(board_id: ${boardId}, item_id: ${itemId}, column_values: "{\\"${columnId}\\": \\"${formattedValue}\\"}" ) {
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

app.listen(PORT, () => {
    console.log(`Serveur à l'écoute sur le port ${PORT}`);
});