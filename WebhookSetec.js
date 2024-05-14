const express = require('express');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY;
const API_URL = process.env.API_URL;

app.post('/webhook', async (req, res) => {
    console.log("Webhook reçu :", JSON.stringify(req.body, null, 2));

    if (req.body.event) {
        const { pulseName, columnId, value, columnType } = req.body.event;
        const targetBoardId = 6134551495;  // ID du tableau cible

        const itemId = await findItemByName(targetBoardId, pulseName);
        if (itemId) {
            console.log(`Élément trouvé, ID : ${itemId}, mise à jour de la colonne.`);
            await updateColumnValue(targetBoardId, itemId, columnId, value, columnType);
        } else {
            console.log(`Aucun élément trouvé avec le nom '${pulseName}' pour mise à jour.`);
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
        console.log("Réponse de la recherche d'éléments :", JSON.stringify(response.data));
        if (response.data.data && response.data.data.items_page_by_column_values && response.data.data.items_page_by_column_values.items.length > 0) {
            return response.data.data.items_page_by_column_values.items[0].id;  // Renvoie l'ID du premier élément qui correspond
        } else {
            console.log("Aucun élément trouvé avec ce nom :", itemName);
            return null;
        }
    } catch (error) {
        console.error("Erreur lors de la recherche d'élément par nom :", error);
        return null;
    }
}

async function updateColumnValue(boardId, itemId, columnId, value) {
    let formattedValue;

    // Vérifier si la valeur est présente et non nulle, sinon utiliser une chaîne vide
    if (value && value.value !== null) {
        formattedValue = `"${value.value.replace(/"/g, '\\"')}"`; // Assurer que le texte est correctement échappé
    } else {
        formattedValue = `""`; // Envoyer une chaîne vide si la valeur est nulle
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
        data: JSON.stringify({ query: mutation }) // Encapsuler la mutation dans un objet JSON
    };

    try {
        const response = await axios(config);
        console.log("Colonne mise à jour avec succès :", JSON.stringify(response.data));
    } catch (error) {
        console.error("Erreur lors de la mise à jour de la colonne :", JSON.stringify(error.response ? error.response.data : error.message));
    }
}



app.listen(PORT, () => {
    console.log(`Serveur à l'écoute sur le port ${PORT}`);
});
