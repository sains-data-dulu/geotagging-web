/**
 * Penerima data Geotag Grid -> Google Sheets (data) + Google Drive (foto).
 * Cara pasang: lihat README.md bagian "Kirim ke Google Sheets".
 */
const SHEET_NAME = 'data';
const FOLDER_NAME = 'Geotag Grid - Foto';   // folder foto di Google Drive (dibuat otomatis)
const FOLDER_ID = '';                        // opsional: isi ID folder Drive tertentu
const KOLOM = ['uuid','id_sub','id_polygon_asal','sub_posisi','petugas','waktu','latitude','longitude','akurasi_m','altitude_m',
  'di_dalam_grid','jarak_ke_grid_m','jenis_tanaman','jenis_lahan','fase_tumbuh','topografi','pola_tanam','catatan',
  'jumlah_foto','foto','foto_url','dibuat','diubah','diterima_server'];

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const body = JSON.parse(e.postData.contents);
    const rec = body.record;
    if (!rec || !rec.uuid) throw new Error('data tidak valid');

    // 1) simpan foto baru ke Drive (lewati yang namanya sudah ada)
    const folder = getFolder();
    (body.photos || []).forEach(p => {
      if (!folder.getFilesByName(p.name).hasNext()) {
        folder.createFile(Utilities.newBlob(Utilities.base64Decode(p.data), 'image/jpeg', p.name));
      }
    });
    // 2) link semua foto milik data ini
    const names = String(rec.foto || '').split(';').map(s => s.trim()).filter(String);
    const urls = names.map(n => { const it = folder.getFilesByName(n); return it.hasNext() ? it.next().getUrl() : ''; });

    // 3) tulis / perbarui baris berdasarkan uuid
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sh = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
    if (sh.getLastRow() === 0) { sh.appendRow(KOLOM); sh.setFrozenRows(1); sh.getRange(1, 1, 1, KOLOM.length).setFontWeight('bold'); }
    const row = KOLOM.map(k => k === 'foto_url' ? urls.join('\n') : k === 'diterima_server' ? new Date() : (rec[k] === undefined ? '' : rec[k]));
    const n = sh.getLastRow() - 1;
    const ids = n > 0 ? sh.getRange(2, 1, n, 1).getValues().map(r => String(r[0])) : [];
    const idx = ids.indexOf(String(rec.uuid));
    if (idx >= 0) sh.getRange(idx + 2, 1, 1, KOLOM.length).setValues([row]);
    else sh.appendRow(row);

    return json({ ok: true, uuid: rec.uuid, foto: urls.length });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function getFolder() {
  if (FOLDER_ID) return DriveApp.getFolderById(FOLDER_ID);
  const it = DriveApp.getFoldersByName(FOLDER_NAME);
  return it.hasNext() ? it.next() : DriveApp.createFolder(FOLDER_NAME);
}

// GET ?action=data -> seluruh data untuk halaman monitoring
function doGet(e) {
  if (e && e.parameter && e.parameter.action === 'data') {
    const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
    if (!sh || sh.getLastRow() < 2) return json({ ok: true, records: [] });
    const values = sh.getDataRange().getValues();
    const head = values.shift().map(String);
    const records = values.filter(r => r[0] !== '').map(r => {
      const o = {}; head.forEach((k, i) => o[k] = r[i] instanceof Date ? r[i].toISOString() : r[i]); return o;
    });
    return json({ ok: true, records: records, updated: new Date().toISOString() });
  }
  return json({ ok: true, info: 'Endpoint Geotag Grid aktif' });
}

function json(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
