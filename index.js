// WA BOT CATAT KEUANGAN
const { default: makeWASocket, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const fs = require('fs');
const xlsx = require('xlsx');
const { existsSync, mkdirSync } = require('fs');
const { join } = require('path');
const { format } = require('date-fns');
const { google } = require('googleapis');
require('dotenv').config();

const authDir = './auth';
if (!existsSync(authDir)) mkdirSync(authDir);

async function uploadToGoogleSheets(tanggal, nominal, keterangan) {
  const sheetsClient = new google.auth.JWT(
    process.env.GOOGLE_CLIENT_EMAIL,
    null,
    process.env.GOOGLE_PRIVATE_KEY.replace(/\n/g, '\n'),
    ['https://www.googleapis.com/auth/spreadsheets']
  );
  await sheetsClient.authorize();
  const sheets = google.sheets({ version: 'v4', auth: sheetsClient });

  await sheets.spreadsheets.values.append({
    spreadsheetId: process.env.SPREADSHEET_ID,
    range: 'Sheet1!A:C',
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [[tanggal, nominal, keterangan]],
    },
  });
  console.log('✅ Data dikirim ke Google Sheets');
}

async function connectWA() {
  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  const sock = makeWASocket({ auth: state, printQRInTerminal: true });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message || !msg.message.conversation) return;

    const from = msg.key.remoteJid;
    const isGroup = from.endsWith('@g.us');
    if (!isGroup) return;

    let metadata;
    try {
      metadata = await sock.groupMetadata(from);
    } catch (err) {
      return;
    }

    if (metadata.subject !== 'CATAT 🔥') return;

    const pesan = msg.message.conversation.toLowerCase().trim();
    const filePath = join(__dirname, 'pengeluaran.xlsx');
    const daftarBulan = {
      januari: 1, februari: 2, maret: 3, april: 4, mei: 5, juni: 6,
      juli: 7, agustus: 8, september: 9, oktober: 10, november: 11, desember: 12
    };

    if (pesan.startsWith('catat')) {
      const bagian = pesan.split(' ');
      if (bagian.length < 3) {
        return sock.sendMessage(from, { text: 'Format salah. Gunakan:\ncatat 50000 makan siang' });
      }

      const nominal = parseInt(bagian[1]);
      if (isNaN(nominal)) {
        return sock.sendMessage(from, { text: 'Nominal harus angka. Contoh:\ncatat 50000 makan siang' });
      }

      const keterangan = bagian.slice(2).join(' ');
      const tanggal = new Date();
      const tanggalFormat = format(tanggal, 'yyyy-MM-dd');

      let data = [];
      if (existsSync(filePath)) {
        const workbook = xlsx.readFile(filePath);
        const worksheet = workbook.Sheets[workbook.SheetNames[0]];
        data = xlsx.utils.sheet_to_json(worksheet);
      }

      data.push({ tanggal: tanggalFormat, nominal, keterangan });

      const worksheet = xlsx.utils.json_to_sheet(data);
      const workbook = xlsx.utils.book_new();
      xlsx.utils.book_append_sheet(workbook, worksheet, 'Pengeluaran');
      xlsx.writeFile(workbook, filePath);

      await uploadToGoogleSheets(tanggalFormat, nominal, keterangan);

      return sock.sendMessage(from, {
        text: `✅ Tercatat: Rp${nominal.toLocaleString()} untuk "${keterangan}"`
      });
    }

    if (pesan.startsWith('rekap')) {
      let bulanInput = pesan.replace('rekap', '').trim();
      let bulanSekarang = new Date().getMonth() + 1;
      let tahunSekarang = new Date().getFullYear();
      let bulanDicari = bulanSekarang;

      if (bulanInput && bulanInput !== 'bulan ini') {
        if (!daftarBulan[bulanInput]) {
          return sock.sendMessage(from, { text: 'Bulan tidak dikenal. Gunakan nama bulan seperti Januari, Februari, dst.' });
        }
        bulanDicari = daftarBulan[bulanInput];
      }

      if (!existsSync(filePath)) {
        return sock.sendMessage(from, { text: 'Belum ada catatan pengeluaran.' });
      }

      const workbook = xlsx.readFile(filePath);
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const data = xlsx.utils.sheet_to_json(worksheet);

      const total = data.reduce((sum, row) => {
        const tgl = new Date(row.tanggal);
        const bulan = tgl.getMonth() + 1;
        const tahun = tgl.getFullYear();
        if (bulan === bulanDicari && tahun === tahunSekarang) {
          return sum + parseInt(row.nominal || 0);
        }
        return sum;
      }, 0);

      const namaBulan = Object.keys(daftarBulan).find(key => daftarBulan[key] === bulanDicari);
      return sock.sendMessage(from, {
        text: `📊 Rekap bulan *${namaBulan.toUpperCase()}*:\nTotal: *Rp${total.toLocaleString()}*`
      });
    }

    return sock.sendMessage(from, {
      text: 'Perintah tidak dikenali.\nGunakan:\n- catat [nominal] [keterangan]\n- rekap [nama bulan]'
    });
  });
}

connectWA();