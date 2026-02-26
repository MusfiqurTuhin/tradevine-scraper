const express = require('express');
const path = require('path');
const scrapeListings = require('./scraper');
const fs = require('fs');

const app = express();
const port = 3000;

app.use(express.json());
app.use(express.static('public'));

let isScraping = false;
let lastScrapeTime = null;
let lastItemCount = 0;
let error = null;

// Log streaming state
const logClients = new Set();
const broadcastLog = (message) => {
    const data = JSON.stringify({ message, timestamp: new Date().toISOString() });
    logClients.forEach(client => client.res.write(`data: ${data}\n\n`));
};

// Override console.log to share with UI
const originalLog = console.log;
console.log = (...args) => {
    originalLog(...args);
    broadcastLog(args.join(' '));
};

app.get('/api/status', (req, res) => {
    res.json({ isScraping, lastScrapeTime, lastItemCount, error });
});

app.get('/api/logs', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const client = { res };
    logClients.add(client);

    req.on('close', () => {
        logClients.delete(client);
    });
});

app.post('/api/scrape', async (req, res) => {
    if (isScraping) {
        return res.status(400).json({ message: 'Scraping already in progress' });
    }

    const { targetCount, email, password } = req.body;
    isScraping = true;
    error = null;
    res.json({ message: 'Scraping started' });

    try {
        console.log('--- Starting new scrape session ---');
        lastItemCount = await scrapeListings(targetCount, email, password);
        lastScrapeTime = new Date().toISOString();
        console.log('--- Scrape session completed successfully ---');
    } catch (err) {
        console.error('Scrape failed:', err);
        error = err.message;
        broadcastLog(`ERROR: ${err.message}`);
    } finally {
        isScraping = false;
    }
});

app.get('/api/download', (req, res) => {
    const filePath = path.join(__dirname, 'listings.csv');
    if (fs.existsSync(filePath)) {
        res.download(filePath, 'tradevine_listings.csv');
    } else {
        res.status(404).json({ message: 'CSV not found. Please run scrape first.' });
    }
});

app.listen(port, () => {
    originalLog(`Server running at http://localhost:${port}`);
});
