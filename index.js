const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const cron = require('node-cron');

// CREATE CLIENT (this was missing)
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

let birthdays = {};

if (fs.existsSync('birthdays.json')) {
    birthdays = JSON.parse(fs.readFileSync('birthdays.json'));
}

// QR
client.on('qr', qr => {
    qrcode.generate(qr, { small: true });
});

// READY
client.on('ready', () => {
    console.log('Bot is ready!');
});

// MESSAGE LISTENER (fixed)
client.on('message_create', async msg => {
    if (msg.fromMe) return;

    console.log("MESSAGE:", msg.body);

    if (msg.body.startsWith('!setbirthday')) {
        let parts = msg.body.split(' ');

        if (parts.length < 2) {
            await msg.reply('❌ Use: !setbirthday DD-MM');
            return;
        }

        let date = parts[1];
        let user = msg.author || msg.from;

        birthdays[user] = date;

        fs.writeFileSync('birthdays.json', JSON.stringify(birthdays, null, 2));

        await msg.reply('🎉 Birthday saved!');
    }
});

// DAILY CHECK
cron.schedule('0 9 * * *', () => {
    const today = new Date();
    const todayStr = `${today.getDate()}-${today.getMonth() + 1}`;

    for (let user in birthdays) {
        if (birthdays[user] === todayStr) {
            client.sendMessage(user, '🎂 Happy Birthday!');
        }
    }
});

client.initialize();