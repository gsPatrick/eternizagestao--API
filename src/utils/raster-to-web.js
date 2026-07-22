'use strict';

/**
 * Converte um raster (GeoTIFF) numa imagem que o NAVEGADOR consegue exibir.
 *
 * Por que é necessário: nenhum navegador renderiza TIFF. O .tif serve para ler
 * a georreferência — mas a imagem mostrada no mapa precisa ser PNG/JPEG. Além
 * disso, ortomosaico de drone passa fácil de 100 MB e 16.000 px de largura;
 * jogar isso no navegador trava a máquina do operador.
 *
 * Duas rotas, nesta ordem:
 *   1. sharp (libvips) — rápido, em processo, resolve o TIFF comum.
 *   2. gdal_translate  — para o que o libvips não decodifica. Ortomosaico do
 *      GDAL costuma sair com JPEG de 4 canais (RGBA) dentro do TIFF, e o
 *      libvips falha com "decompress error tile". O GDAL lê o próprio formato
 *      que gerou.
 *
 * Se as duas falharem, LANÇA. Guardar um arquivo que o navegador não exibe
 * seria repetir o problema que estamos resolvendo.
 */

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

// Largura máxima da imagem web. 8000 px sobre um terreno de ~400 m dá ~5 cm por
// pixel — mais do que suficiente para distinguir sepulturas, e o arquivo fica
// numa faixa que o navegador aguenta.
const MAX_WEB_PX = Number(process.env.ORTHO_WEB_MAX_PX || 8000);

function runCommand(cmd, args, timeoutMs = 180000) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`${cmd}: tempo esgotado`));
    }, timeoutMs);
    child.stderr.on('data', (d) => { stderr += String(d); });
    child.on('error', (err) => { clearTimeout(timer); reject(err); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`${cmd} falhou (${code}): ${stderr.trim().split('\n').pop() || ''}`));
    });
  });
}

function loadSharp() {
  try {
    // eslint-disable-next-line global-require
    return require('sharp');
  } catch {
    return null;
  }
}

/**
 * Comprime para WEBP.
 *
 * Escolha do formato: PNG de foto aérea fica MAIOR que o TIFF original (medido:
 * 116 MB -> 52 MB de PNG). JPEG comprime bem, mas não tem transparência, e a
 * borda sem dado do ortomosaico viraria uma tarja preta sobre o mapa. WEBP
 * resolve os dois: 116 MB -> 5 MB preservando o canal alfa.
 */
function toWeb(sharp, entrada) {
  return sharp(entrada, { limitInputPixels: false })
    .resize({ width: MAX_WEB_PX, height: MAX_WEB_PX, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer();
}

async function viaSharp(buffer) {
  const sharp = loadSharp();
  if (!sharp) return null; // dependência ausente — tenta a próxima rota
  return toWeb(sharp, buffer);
}

async function viaGdal(buffer, widthPx, heightPx) {
  const sharp = loadSharp();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ortho-'));
  const entrada = path.join(dir, 'in.tif');
  const saida = path.join(dir, 'out.png');
  try {
    fs.writeFileSync(entrada, buffer);

    // -outsize preserva a proporção quando só a largura é dada em porcentagem;
    // calculamos a escala para não passar de MAX_WEB_PX no maior lado.
    const maior = Math.max(widthPx || 0, heightPx || 0);
    const args = ['-of', 'PNG', '-co', 'ZLEVEL=9'];
    if (maior > MAX_WEB_PX) {
      const pct = Math.max(1, Math.round((MAX_WEB_PX / maior) * 100));
      args.push('-outsize', `${pct}%`, `${pct}%`);
    }
    args.push(entrada, saida);

    await runCommand('gdal_translate', args);
    // O GDAL decodifica; quem comprime é o sharp (o PNG do GDAL sai enorme).
    // AWAIT obrigatório: devolver a promise faria o `finally` apagar a pasta
    // temporária antes de o sharp terminar de ler o arquivo.
    if (sharp) {
      const comprimido = await toWeb(sharp, saida);
      return comprimido;
    }
    return fs.readFileSync(saida);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * @param {Buffer} buffer arquivo original (TIFF)
 * @param {{ widthPx?:number, heightPx?:number }} meta dimensões conhecidas
 * @returns {Promise<{ content: Buffer, mimeType: string, driver: string }>}
 */
async function rasterToWebImage(buffer, { widthPx, heightPx } = {}) {
  const erros = [];

  try {
    const out = await viaSharp(buffer);
    if (out && out.length) return { content: out, mimeType: 'image/webp', driver: 'sharp' };
  } catch (err) {
    erros.push(`sharp: ${err.message.split('\n')[0]}`);
  }

  try {
    const out = await viaGdal(buffer, widthPx, heightPx);
    if (out && out.length) {
      return { content: out, mimeType: loadSharp() ? 'image/webp' : 'image/png', driver: 'gdal' };
    }
  } catch (err) {
    erros.push(`gdal: ${err.message.split('\n')[0]}`);
  }

  const detalhe = erros.join(' | ');
  const err = new Error(
    'Não foi possível converter o GeoTIFF para exibição no navegador. '
    + 'Envie também uma versão em PNG ou JPG da mesma ortofoto. '
    + `(${detalhe})`
  );
  err.code = 'RASTER_CONVERSION_FAILED';
  throw err;
}

module.exports = { rasterToWebImage, MAX_WEB_PX };
