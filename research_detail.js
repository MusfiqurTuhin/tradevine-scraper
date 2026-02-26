const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

async function researchDetail() {
    const userDataDir = path.join(__dirname, 'user_data');
    console.log(`Using user data: ${userDataDir}`);

    const browserContext = await chromium.launchPersistentContext(userDataDir, {
        headless: false,
        args: ['--disable-blink-features=AutomationControlled']
    });
    const page = await browserContext.newPage();

    console.log('Navigating to listings...');
    try {
        await page.goto('https://nz.tradevine.com/idiyaltd/Listings/List?importActiveListings=False', { timeout: 60000 });
        await page.waitForTimeout(5000);

        console.log('Searching for product name links...');
        // The user says click on product name. Product name is usually the text link.
        // Based on previous screenshot, product name is the larger text below the ID.
        // Let's find links inside .colTitles that contain the product name.
        const products = await page.$$('.listingCell');
        console.log(`Found ${products.length} product cells.`);

        if (products.length > 0) {
            const firstProduct = products[0];
            // Find the link with the title attribute or the one that isn't the ID link
            const nameLink = await firstProduct.$('.colTitles div a[title], .colTitles div a:not([href*="Listing.aspx"])');

            if (nameLink) {
                const nameText = await nameLink.innerText();
                const href = await nameLink.getAttribute('href');
                console.log(`Clicking product name: "${nameText}" -> ${href}`);

                await nameLink.click();
                await page.waitForTimeout(10000);

                console.log(`Final URL: ${page.url()}`);
                const html = await page.content();
                fs.writeFileSync('detail_page_v3.html', html);
                await page.screenshot({ path: 'detail_page_v3.png' });
                console.log('Detail page v3 (Product Name Click) dumped.');
            } else {
                console.log('Could not find name link in first product cell.');
            }
        }

    } catch (err) {
        console.error('Error during research:', err);
    }

    await browserContext.close();
}

researchDetail().catch(console.error);
