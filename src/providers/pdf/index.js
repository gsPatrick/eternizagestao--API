'use strict';

/**
 * Provider de geração de PDF — ABSTRAÇÃO TROCÁVEL.
 * -----------------------------------------------------------------------------
 * Interface única, independente de tecnologia:
 *
 *   htmlToPdf(html, { format='A4', margin? }) => Promise<Buffer>   // bytes do PDF
 *   resolveDriverName() => 'puppeteer' | 'fallback'               // introspecção
 *
 * DRIVER selecionado por env `PDF_DRIVER` (default: 'puppeteer'):
 *   - `puppeteer` → headless Chrome, FIEL ao HTML/cores/logo (instância singleton
 *     reaproveitada, lançada sob demanda, com timeout). É o default.
 *   - `fallback`  → gera um PDF simples (texto do HTML) SEM browser — garante
 *     `application/pdf` mesmo sem Chromium.
 *
 * TOLERÂNCIA A FALHA: com `puppeteer`, se o pacote não carregar OU o Chromium não
 * estiver disponível/lançar erro, o provider CAI AUTOMATICAMENTE no `fallback` —
 * nunca lança para o chamador. Assim a emissão/downloads nunca quebram por PDF.
 *
 * Trocar de tecnologia (wkhtmltopdf, serviço externo, etc.) = novo arquivo em
 * ./drivers com a MESMA interface + um branch aqui. Nenhuma feature muda.
 */

const fallback = require('./drivers/fallback');

// O driver `puppeteer` depende do pacote `puppeteer` (require pode lançar se
// ausente) e do Chromium (só falha no launch). Carregamento preguiçoso + memo.
let _puppeteer; // undefined = ainda não tentou; null = indisponível
let _puppeteerError = null;
function loadPuppeteerDriver() {
  if (_puppeteer === undefined) {
    try {
      // eslint-disable-next-line global-require
      _puppeteer = require('./drivers/puppeteer');
    } catch (err) {
      _puppeteer = null;
      _puppeteerError = err;
      console.warn('[pdf] driver puppeteer indisponível (usando fallback):', err.message);
    }
  }
  return _puppeteer;
}

const DRIVER_NAME = (process.env.PDF_DRIVER || 'puppeteer').toLowerCase();

/**
 * Converte HTML em um Buffer de PDF. Nunca lança: em qualquer falha do driver
 * primário, degrada para o `fallback`.
 * @param {string} html
 * @param {{ format?: string, margin?: object }} [options]
 * @returns {Promise<Buffer>}
 */
async function htmlToPdf(html, options = {}) {
  if (DRIVER_NAME !== 'fallback') {
    const driver = loadPuppeteerDriver();
    if (driver) {
      try {
        return await driver.htmlToPdf(html, options);
      } catch (err) {
        // Chromium indisponível / timeout / crash — degrada sem quebrar.
        console.warn('[pdf] geração com puppeteer falhou, usando fallback:', err.message);
      }
    }
  }
  return fallback.htmlToPdf(html, options);
}

// Nome do driver que efetivamente atenderia agora (introspecção/diagnóstico).
function resolveDriverName() {
  if (DRIVER_NAME === 'fallback') return 'fallback';
  return loadPuppeteerDriver() ? 'puppeteer' : 'fallback';
}

module.exports = { htmlToPdf, resolveDriverName, configuredDriver: DRIVER_NAME };
