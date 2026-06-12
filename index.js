const { default: makeWASocket, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');
const readline = require('readline');

// Setup Readline untuk input nomor telepon di Termux (Pairing Code)
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const question = (text) => new Promise((resolve) => rl.question(text, resolve));

// ================= PENGATURAN E-WALLET =================
// Ubah nomor dan nama sesuai dengan akun E-Wallet kamu
const EWALLET = {
    DANA: "085129936619 (a.n Irwanto)",
    GOPAY: "085129936619 (a.n VinnoCode)",
    SEABANK: "901582971512 (a.n Jawini)"
};

// ================= DATABASE SYSTEM (JSON) =================
const DB_FILE = './database.json';
if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({ sesiOrder: {}, riwayatTransaksi: {} }, null, 2));
}

function readDB() {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
}

function writeDB(data) {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

// ================= KATALOG PRODUK =================
const katalogProduk = {
    '1': { nama: 'Jasa Unband Kenon Spam', harga: 15000 },
    '2': { nama: 'Jasa Unband Kenon Batu', harga: 25000 },
    '3': { nama: 'Jasa Unband Kenon Batu Hard', harga: 35000 },
    '4': { nama: 'Jasa Unband Kenon Lumut', harga: 45000 },
    '5': { nama: 'Jasa Unband Kenon Lumut Hard', harga: 55000 },
    '6': { nama: 'Jasa Unband Kenon Fresh Kenon', harga: 65000 }
};

const formatRupiah = (angka) => {
    return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(angka);
};

// ================= MAIN BOT FUNCTION =================
async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    
    const sock = makeWASocket({
        logger: pino({ level: 'info' }),
        printQRInTerminal: false, // QR dimatikan karena pakai Pairing Code
        auth: state,
        browser: ["Ubuntu", "Chrome", "20.0.04"]
    });

    // FITUR PAIRING CODE
    if (!sock.authState.creds.registered) {
        console.log("=== CODE PAIRING ===");
        const phoneNumber = await question('Masukkan nomor WhatsApp Bot Anda (Contoh: 62xxxxxxxxx): ');
        const cleanedNumber = phoneNumber.replace(/[^0-9]/g, '');
        
        console.log('Sedang meminta kode pairing dari WhatsApp...');
        setTimeout(async () => {
            try {
                let code = await sock.requestPairingCode(cleanedNumber);
                code = code?.match(/.{1,4}/g)?.join('-') || code;
                console.log(`\n👉 KODE PAIRING ANDA: \x1b[32m${code}\x1b[0m`);
                console.log('Masukkan kode di atas pada WhatsApp Anda (Perangkat Tertaut > Tautkan dengan Nomor Telepon)\n');
            } catch (err) {
                console.error('Gagal mendapatkan kode pairing. Coba jalankan ulang script.', err);
            }
        }, 3000);
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection } = update;
        if(connection === 'close') {
            console.log('Koneksi terputus.');
            console.log(update.lastDisconnect?.error || 'Unknown error');
            setTimeout(() => startBot(), 5000);
        } else if(connection === 'open') {
            console.log('✅ Bot Auto Order E-Wallet Berhasil Terhubung!');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const sender = msg.key.remoteJid;
        const pushName = msg.pushName || 'Pelanggan';
        const textMessage = msg.message.conversation || msg.message.extendedTextMessage?.text || "";
        const args = textMessage.trim().split(/ +/);
        const command = args[0].toLowerCase();

        // Load DB terbaru tiap ada pesan masuk
        let db = readDB();

        if (!db.sesiOrder) db.sesiOrder = {};
        if (!db.riwayatTransaksi) db.riwayatTransaksi = {};

        if (!db.sesiOrder[sender]) {
            db.sesiOrder[sender] = { keranjang: [], total: 0 };
            writeDB(db);
        }

        // ================= BOT COMMANDS =================
        switch (command) {

            case "menu":
            case "bot": {
            let teksMenu = `✨ *SELAMAT DATANG DI TOKO KAMI* ✨\nHalo Kak ${pushName},\n\n🛒 *DAFTAR PRODUK:*\n`;
            for (let key in katalogProduk) {
                teksMenu += `*${key}.* ${katalogProduk[key].nama} - ${formatRupiah(katalogProduk[key].harga)}\n`;
            }
            teksMenu += "\n📋 *CARA ORDER:*\n";
            teksMenu += "• Kirim `pesan [nomor_produk] [jumlah]`\n  Contoh: pesan 1 2\n";
            teksMenu += "• Kirim `keranjang` untuk cek belanjaan\n";
            teksMenu += "• Kirim `checkout` untuk mendapatkan invoice & nomor pembayaran\n";
            teksMenu += "• Kirim `batal` untuk hapus keranjang";
            
            await sock.sendMessage(sender, { text: teksMenu }, { quoted: msg });
            break;
        }

            case "pesan": {
            const idProduk = args[1];
            const jumlah = parseInt(args[2]) || 1;

            if (!idProduk || !katalogProduk[idProduk]) {
                return await sock.sendMessage(sender, { text: '⚠️ Produk tidak ditemukan. Ketik `menu` untuk list produk.' });
            }

            const produk = katalogProduk[idProduk];
            const subtotal = produk.harga * jumlah;

            db.sesiOrder[sender].keranjang.push({ nama: produk.nama, harga: produk.harga, jumlah, subtotal });
            db.sesiOrder[sender].total += subtotal;
            writeDB(db); 

            await sock.sendMessage(sender, { 
                text: `✅ *Berhasil masuk keranjang!*\n\n📦 *${produk.nama}*\n🔢 Jumlah: ${jumlah}\n💵 Subtotal: ${formatRupiah(subtotal)}\n\nKetik \`keranjang\` atau langsung \`checkout\`` 
            });
            break;
        }

            case "keranjang": {
            const cart = db.sesiOrder[sender];
            if (cart.keranjang.length === 0) {
                return await sock.sendMessage(sender, { text: '🛒 Keranjang belanja Anda masih kosong.' });
            }

            let teksCart = "🛒 *KERANJANG BELANJA ANDA* 🛒\n\n";
            cart.keranjang.forEach((item, index) => {
                teksCart += `${index + 1}. ${item.nama}\n   ${item.jumlah}x ➔ ${formatRupiah(item.subtotal)}\n`;
            });
            teksCart += `\n💰 *Total Tagihan: ${formatRupiah(cart.total)}*\n\nKetik \`checkout\` untuk melanjutkan ke pembayaran.`;
            await sock.sendMessage(sender, { text: teksCart });
            break;
        }

            case "checkout": {
            const cart = db.sesiOrder[sender];
            if (cart.keranjang.length === 0) {
                return await sock.sendMessage(sender, { text: '⚠️ Anda belum memesan apapun.' });
            }

            const merchantRef = 'INV-' + Date.now();
            const totalBayar = cart.total;

            // Simpan transaksi ke database history dengan status Menunggu Pembayaran
            db.riwayatTransaksi[merchantRef] = {
                status: 'MENUNGGU_PEMBAYARAN_MANUAL',
                sender: sender,
                namaPelanggan: pushName,
                total: totalBayar,
                detail: cart.keranjang,
                waktu: new Date().toLocaleString('id-ID')
            };
            
            // Reset keranjang user
            db.sesiOrder[sender] = { keranjang: [], total: 0 };
            writeDB(db);

            let teksInvoice = `🧾 *STRUCTUR PEMBAYARAN* 🧾\n\n`;
            teksInvoice += `🆔 No. Structur: *${merchantRef}*\n`;
            teksInvoice += `👤 Pelanggan: ${pushName}\n`;
            teksInvoice += `💰 Total Tagihan: *${formatRupiah(totalBayar)}*\n\n`;
            
            teksInvoice += `💳 *METODE PEMBAYARAN E-WALLET:*\n`;
            teksInvoice += `• *DANA:* ${EWALLET.DANA}\n`;
            teksInvoice += `• *GOPAY:* ${EWALLET.GOPAY}\n`;
            teksInvoice += `• *SEABANK:* ${EWALLET.SEABANK}\n`;

            teksInvoice += `📌 *PENTING:*\n`;
            teksInvoice += `Silakan lakukan transfer sesuai dengan total tagihan di atas. Jika sudah, kirimkan *FOTO/SCREENSHOT BUKTI TRANSFER* ke chat ini.\n\n`;
            teksInvoice += `Admin akan mengecek dan memproses pesanan Anda sesegera mungkin. Terima kasih! 🙏`;

            await sock.sendMessage(sender, { text: teksInvoice });
            break;
        }

            case "batal": {
            db.sesiOrder[sender] = { keranjang: [], total: 0 };
            writeDB(db);
            await sock.sendMessage(sender, { text: '🗑️ Keranjang belanja Anda telah dihapus.' });
            break;
        }

        }
    });
}

startBot();
