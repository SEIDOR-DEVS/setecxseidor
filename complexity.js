const axios = require('axios');
require('dotenv').config();

const API_KEY = process.env.API_KEY;
const API_URL = process.env.API_URL;

async function getRequestCount() {
    const query = JSON.stringify({
        query: `
            query {
                complexity {
                    before
                    query
                    after
                    reset_in_x_seconds
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
        const response = await axios(config);
        if (response.data.errors) {
            console.error("Erreur dans l'API:", JSON.stringify(response.data.errors));
        } else {
            const complexity = response.data.data.complexity;
            console.log("Cantidad de solicitudes antes de la consulta:", complexity.before);
            console.log("Cantidad de solicitudes después de la consulta:", complexity.after);
            console.log("Tiempo hasta el reinicio del límite (segundos):", complexity.reset_in_x_seconds);
        }
    } catch (error) {
        console.error("Erreur lors de la consulta de la complejidad:", JSON.stringify(error.response ? error.response.data : error.message));
    }
}

getRequestCount();
