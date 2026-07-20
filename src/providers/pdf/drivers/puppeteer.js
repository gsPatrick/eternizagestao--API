'use strict';

/**
 * Driver de PDF `puppeteer` — headless Chrome. Renderiza o HTML branded com
 * FIDELIDADE total (cores, logotipo embutido, cabeçalho do órgão gestor) e
 * imprime em PDF. É o driver DEFAULT.
 *
 * INSTÂNCIA REAPROVEITADA: o browser é um singleton lançado SOB DEMANDA (na 1ª
 * conversão) e mantido vivo entre chamadas — cada documento abre apenas uma nova
 * aba. O launch tem timeout; se o browser cair/desconectar, a próxima chamada
 * relança. Se o Chromium não estiver disponível, o launch REJEITA e o provider
 * (index.js) cai no driver de fallback — este driver nunca é obrigado a existir.
 *
 * Interface: htmlToPdf(html, { format?, margin? }) => Promise<Buffer>
 */

// require pode lançar se o pacote não estiver instalado — é o index quem trata.
const puppeteer = require('puppeteer');

const LAUNCH_TIMEOUT_MS = Number(process.env.PDF_LAUNCH_TIMEOUT_MS || 30000);
const RENDER_TIMEOUT_MS = Number(process.env.PDF_RENDER_TIMEOUT_MS || 30000);

const DEFAULT_MARGIN = { top: '14mm', bottom: '16mm', left: '14mm', right: '14mm' };

let browserPromise = null; // singleton (Promise<Browser>)

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} excedeu ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Lança (ou reaproveita) o browser. Reseta o singleton se o launch falhar ou se
// o processo desconectar, para que a próxima conversão tente de novo.
async function getBrowser() {
  if (browserPromise) {
    try {
      const b = await browserPromise;
      if (b && b.connected !== false && b.isConnected?.() !== false) return b;
    } catch {
      // launch anterior falhou — cai para relançar abaixo
    }
    browserPromise = null;
  }

  browserPromise = puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  browserPromise.catch(() => { browserPromise = null; });

  const browser = await withTimeout(browserPromise, LAUNCH_TIMEOUT_MS, 'launch do Chromium');
  browser.on('disconnected', () => { browserPromise = null; });
  return browser;
}

async function htmlToPdf(html, { format = 'A4', margin } = {}) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    // waitUntil 'load': espera o CSS e as imagens (logo data URI/URL) carregarem.
    // Evitamos 'networkidle0' (pode pendurar o setContent sem tráfego externo).
    await page.setContent(String(html || ''), {
      waitUntil: 'load',
      timeout: RENDER_TIMEOUT_MS,
    });
    const pdf = await page.pdf({
      format,
      printBackground: true, // ESSENCIAL: mantém faixas/realces na cor da cidade
      margin: margin || DEFAULT_MARGIN,
      preferCSSPageSize: false,
    });
    return Buffer.from(pdf);
  } finally {
    await page.close().catch(() => {});
  }
}

// Encerramento gracioso do singleton (usado em testes/shutdown; opcional).
async function close() {
  if (!browserPromise) return;
  try {
    const b = await browserPromise;
    await b.close();
  } catch {
    // já fechado
  } finally {
    browserPromise = null;
  }
}

module.exports = { name: 'puppeteer', htmlToPdf, close };
