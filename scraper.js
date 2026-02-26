const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
require('dotenv').config();

// VERSION: 3.9 - NUCLEAR RESET TO PAGE 1
async function scrapeListings(targetCount = 1217, email, password) {
    console.log('--- SCRAPER ENGINE v3.9 STARTING (NUCLEAR RESET MODE) ---');
    const userDataDir = path.join(__dirname, 'user_data');
    const finalEmail = email || process.env.EMAIL;
    const finalPassword = password || process.env.PASSWORD;

    console.log(`User Data: ${userDataDir}`);
    console.log(`Target: ${targetCount}`);
    console.log(`Creds: ${finalEmail}`);

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
    console.log(`Identified status: ${state.raw}`);

    // NUCLEAR RESET TO PAGE 1
    if (state.start !== 1) {
        console.log('Resetting to Page 1 via input bypass...');
        const pageInput = await page.$('input.go-to-page');
        if (pageInput) {
            await pageInput.click();
            await pageInput.fill('1');
            await pageInput.press('Enter');
            console.log('Sent Page 1 command. Waiting for refresh...');
            await page.waitForTimeout(10000);
            state = await getPageState();
            console.log(`Status after nuclear reset: ${state.raw}`);
        } else {
            console.log('Input box not found. Trying First Page link...');
            const firstLink = await page.$('.paging a.firstPage, a[data-page-number="1"]');
            if (firstLink) {
                await page.evaluate(el => el.click(), firstLink);
                await page.waitForTimeout(10000);
                state = await getPageState();
                console.log(`Status after link reset: ${state.raw}`);
            }
        }
    }

    // Safety final check
    if (state.start !== 1 && state.total > 0) {
        console.log('CRITICAL: Failed to reset to Page 1. Retrying with Direct Navigation...');
        await page.goto(`${baseUrl}&page=1&pageSize=10`);
        await page.waitForTimeout(10000);
        state = await getPageState();
        console.log(`Status after direct URL reset: ${state.raw}`);
    }

    const actualTotal = state.total || targetCount;
    const itemsPerPage = state.perPage || 10;
    const totalPages = Math.ceil(actualTotal / itemsPerPage);

    console.log(`Plan: Collect ${actualTotal} items across ${totalPages} pages.`);

    let allItems = [];
    let currentPageNum = 1;

    while (currentPageNum <= totalPages) {
        console.log(`Scraping page ${currentPageNum}/${totalPages}...`);

        try {
            await page.waitForSelector('.listingCell', { timeout: 20000 });
        } catch (e) {
            console.log('Items not found. Saving diagnostic screenshot...');
            await page.screenshot({ path: `failure_v3.9_p${currentPageNum}.png` });
            break;
        }

        const pageItems = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('.listingCell')).map(cell => {
                const text = cell.innerText;
                const idLink = cell.querySelector('.colTitles div a[href*="Listing.aspx"]');
                const titleLink = cell.querySelector('.colTitles div a[title]');
                const priceMatch = text.match(/Price:\s*\$([\d,.]+)/i) || text.match(/Buy Now Price:\s*\$([\d,.]+)/i);

                return {
                    sku: idLink ? idLink.innerText.trim() : '',
                    title: titleLink ? titleLink.innerText.trim() : '',
                    price: priceMatch ? priceMatch[1] : '',
                    bids: text.match(/Bids\s*(\d+)/i)?.[1] || '0',
                    watchers: text.match(/Watchers\s*(\d+)/i)?.[1] || '0',
                    closing: text.match(/Closes in\s*([^)]+)/i)?.[1] || ''
                };
            }).filter(item => item.sku || item.title);
        });

        allItems = allItems.concat(pageItems);
        console.log(`Page ${currentPageNum} collected ${pageItems.length} items. Total: ${allItems.length}`);

        if (allItems.length >= targetCount) break;

        const previousRawState = state.raw;
        const nextBtn = await page.$('.nextPage:not(.disabled), a:has-text("Next"), .paging a:has-text("Next")');

        if (nextBtn) {
            console.log('Moving to next page...');
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
            if (!changed) {
                console.log('Warning: Page transition stalled.');
                break;
            }
            currentPageNum++;
        } else {
            console.log('End of sequence.');
            break;
        }
    }

    const csvWriter = createCsvWriter({
        path: path.join(__dirname, 'listings.csv'),
        header: [
            { id: 'sku', title: 'SKU/ID' },
            { id: 'title', title: 'Title' },
            { id: 'price', title: 'Price' },
            { id: 'bids', title: 'Bids' },
            { id: 'watchers', title: 'Watchers' },
            { id: 'closing', title: 'Closing Time' }
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
