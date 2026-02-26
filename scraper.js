const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
require('dotenv').config();

// VERSION: 4.0 - DEEP SCRAPING MODE (EXTRACT ACTUAL ID)
async function scrapeListings(targetCount = 1217, email, password) {
    console.log('--- SCRAPER ENGINE v4.0 STARTING (DEEP SCRAPE MODE) ---');
    const userDataDir = path.join(__dirname, 'user_data');
    const finalEmail = email || process.env.EMAIL;
    const finalPassword = password || process.env.PASSWORD;

    const lockFiles = ['SingletonLock', 'SingletonCookie', 'SingletonSocket'];
    lockFiles.forEach(file => {
        const lockPath = path.join(userDataDir, file);
        if (fs.existsSync(lockPath)) {
            try {
                fs.unlinkSync(lockPath);
                console.log(`Cleaned lock: ${file}`);
            } catch (err) {
                console.warn(`Lock warning: ${file}: ${err.message}`);
            }
        }
    });

    const browserContext = await chromium.launchPersistentContext(userDataDir, {
        headless: false,
        viewport: { width: 1280, height: 720 },
        args: ['--disable-blink-features=AutomationControlled']
    });
    const page = await browserContext.newPage();

    async function ensureLoggedIn() {
        console.log('Checking login status...');
        await page.goto('https://nz.tradevine.com/Authentication/LogIn');
        await page.waitForTimeout(5000);

        if (page.url().includes('LogIn')) {
            console.log('Logging in...');
            await page.fill('input[name*="Email"], #Email', finalEmail);
            await page.waitForTimeout(500);
            await page.fill('input[name*="Password"], #Password', finalPassword);
            await page.waitForTimeout(500);

            const submitBtn = await page.$('button[type="submit"], input[type="submit"], .btn-primary, #signInButton');
            if (submitBtn) {
                await page.evaluate(el => el.click(), submitBtn);
            } else {
                throw new Error('Login submit button not found');
            }
            await page.waitForTimeout(10000);
        } else {
            console.log('Already logged in.');
        }
    }

    await ensureLoggedIn();

    const baseUrl = 'https://nz.tradevine.com/idiyaltd/Listings/List?importActiveListings=False';
    console.log(`Navigating to entries...`);
    await page.goto(baseUrl);
    await page.waitForTimeout(10000);

    const getPageState = async () => {
        return await page.evaluate(() => {
            const text = document.querySelector('.itemCount')?.innerText || '';
            const match = text.match(/Viewing\s*([\d,]+)-([\d,]+)\s*of\s*([\d,]+)/i);
            if (match) {
                const start = parseInt(match[1].replace(/,/g, ''));
                const end = parseInt(match[2].replace(/,/g, ''));
                const total = parseInt(match[3].replace(/,/g, ''));
                return { raw: text, start, end, total, perPage: (end - start + 1) };
            }
            return { raw: text, total: 0, perPage: 0, start: 0 };
        });
    };

    let state = await getPageState();
    if (state.start !== 1 && state.total > 0) {
        console.log('Resetting to Page 1...');
        const pageInput = await page.$('input.go-to-page');
        if (pageInput) {
            await pageInput.fill('1');
            await pageInput.press('Enter');
            await page.waitForTimeout(10000);
            state = await getPageState();
        }
    }

    const actualTotal = state.total || targetCount;
    const itemsPerPage = state.perPage || 10;
    const totalPages = Math.ceil(actualTotal / itemsPerPage);

    let allItems = [];
    let currentPageNum = 1;

    console.log(`Plan: Deep scrape ${actualTotal} items across ${totalPages} pages.`);

    while (currentPageNum <= totalPages) {
        console.log(`Scraping page ${currentPageNum}/${totalPages}...`);

        try {
            await page.waitForSelector('.listingCell', { timeout: 20000 });
        } catch (e) {
            console.log('Items not found. Saving diagnostic screenshot...');
            await page.screenshot({ path: `failure_v4.0_p${currentPageNum}.png` });
            break;
        }

        // 1. Extract List Data and Detail Links
        const pageItems = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('.listingCell')).map(cell => {
                const text = cell.innerText;
                const idLink = cell.querySelector('.colTitles div a[href*="Listing.aspx"]');
                const nameLink = cell.querySelector('.colTitles div a[title], .colTitles div a:not([href*="Listing.aspx"])');
                const priceMatch = text.match(/Price:\s*\$([\d,.]+)/i) || text.match(/Buy Now Price:\s*\$([\d,.]+)/i);

                return {
                    sku: idLink ? idLink.innerText.trim() : '',
                    title: nameLink ? nameLink.innerText.trim() : '',
                    price: priceMatch ? priceMatch[1] : '',
                    detailUrl: nameLink ? nameLink.href : null,
                    actualId: 'Pending...'
                };
            }).filter(item => item.sku || item.title);
        });

        // 2. Perform Deep Scrape for each item
        const detailPage = await browserContext.newPage();
        for (let i = 0; i < pageItems.length; i++) {
            const item = pageItems[i];
            if (item.detailUrl) {
                console.log(`   [${i + 1}/${pageItems.length}] Extracting Actual ID for: ${item.title}`);
                try {
                    await detailPage.goto(item.detailUrl, { timeout: 30000 });
                    const actualId = await detailPage.evaluate(() => {
                        return document.querySelector('#content-title .title h1')?.innerText.trim() || 'Not Found';
                    });
                    item.actualId = actualId;
                } catch (err) {
                    console.log(`   ⚠️ Failed to load details for ${item.title}`);
                    item.actualId = 'Error';
                }
            }
        }
        await detailPage.close();

        allItems = allItems.concat(pageItems);
        console.log(`Page ${currentPageNum} completed. Total items: ${allItems.length}`);

        if (allItems.length >= targetCount) break;

        const previousRawState = state.raw;
        const nextBtn = await page.$('.nextPage:not(.disabled), a:has-text("Next"), .paging a:has-text("Next")');

        if (nextBtn) {
            console.log('Moving to next grid page...');
            await page.evaluate(el => el.click(), nextBtn);

            let changed = false;
            for (let i = 0; i < 15; i++) {
                await page.waitForTimeout(2000);
                state = await getPageState();
                if (state.raw !== previousRawState) {
                    changed = true;
                    break;
                }
            }
            if (!changed) break;
            currentPageNum++;
        } else {
            break;
        }
    }

    const csvWriter = createCsvWriter({
        path: path.join(__dirname, 'listings.csv'),
        header: [
            { id: 'sku', title: 'SKU/ID' },
            { id: 'actualId', title: 'Actual ID' },
            { id: 'title', title: 'Title' },
            { id: 'price', title: 'Price' }
        ]
    });

    await csvWriter.writeRecords(allItems);
    console.log(`Successfully saved ${allItems.length} items to listings.csv`);

    await browserContext.close();
    return allItems.length;
}

if (require.main === module) {
    const args = process.argv.slice(2);
    const targetCount = args[0] ? parseInt(args[0]) : 1217;
    const email = args[1] || process.env.EMAIL;
    const password = args[2] || process.env.PASSWORD;

    scrapeListings(targetCount, email, password).catch(err => {
        console.error('Fatal engine error:', err);
        process.exit(1);
    });
}

module.exports = scrapeListings;
