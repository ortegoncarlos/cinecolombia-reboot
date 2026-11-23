import { chromium } from 'playwright-core';
export const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
export const IPHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: UA, locale: 'es-CO', timezoneId: 'America/Bogota' };
export const launch = (headless = true) => chromium.launch({ channel: 'chrome', headless, args: ['--disable-blink-features=AutomationControlled'] });
export const sleep = ms => new Promise(r => setTimeout(r, ms));
