// Discord Confession Bot - Full Slash Commands
// Version corrigée et nettoyée — compatible Node.js et discord.js v14

const { Client, GatewayIntentBits, Partials, REST, Routes, SlashCommandBuilder, ActivityType } = require('discord.js');
const dotenv = require('dotenv');
dotenv.config();

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
    partials: [Partials.Channel]
});

const OWNER_ID = "1133246357960921158";

let confessionChannel = null;
let logsChannel = null;

// SQLite setup
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./confessions.db');

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS confessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT,
        content TEXT,
        date TEXT
    )`);
});

// Slash commands
const commands = [
    new SlashCommandBuilder()
        .setName('confession')
        .setDescription('Envoyer une confession anonyme.')
        .addStringOption(opt => opt.setName('description').setDescription('Votre confession').setRequired(true)),

    new SlashCommandBuilder()
        .setName('setchannel')
        .setDescription('Définir le salon de confessions (Owner uniquement).')
        .addChannelOption(opt => opt.setName('salon').setDescription('Salon').setRequired(true)),

    new SlashCommandBuilder()
        .setName('setlogs')
        .setDescription('Définir le salon des logs (Owner uniquement).')
        .addChannelOption(opt => opt.setName('salon').setDescription('Salon').setRequired(true)),

    new SlashCommandBuilder()
        .setName('bot-avatar')
        .setDescription('Changer avatar du bot (Owner uniquement).')
        .addStringOption(opt => opt.setName('url').setDescription('URL image').setRequired(true)),

    new SlashCommandBuilder()
        .setName('bot-name')
        .setDescription('Changer pseudo du bot (Owner uniquement).')
        .addStringOption(opt => opt.setName('nom').setDescription('Nouveau nom du bot').setRequired(true)),

    new SlashCommandBuilder()
        .setName('bot-status')
        .setDescription('Changer le status du bot (Owner uniquement).')
        .addStringOption(opt =>
            opt.setName('status')
                .setDescription('Choisir un status')
                .setRequired(true)
                .addChoices(
                    { name: 'online', value: 'online' },
                    { name: 'dnd', value: 'dnd' },
                    { name: 'idle', value: 'idle' },
                    { name: 'invisible', value: 'invisible' }
                )
        ),

    new SlashCommandBuilder()
        .setName('bot-activities')
        .setDescription('Changer activité du bot (Owner uniquement).')
        .addStringOption(opt =>
            opt.setName('type')
                .setDescription('Type activité')
                .setRequired(true)
                .addChoices(
                    { name: 'Playing', value: 'playing' },
                    { name: 'Watching', value: 'watching' },
                    { name: 'Streaming', value: 'streaming' },
                    { name: 'Competing', value: 'compete' }
                )
        )
        .addStringOption(opt => opt.setName('description').setDescription('Texte activité').setRequired(true))
];

const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

async function registerCommands() {
    try {
        await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
        console.log('Slash commands correctement enregistrées.');
    } catch (err) {
        console.error(err);
    }
}
registerCommands();

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const name = interaction.commandName;
    const isOwner = interaction.user.id === OWNER_ID;

    // -------------------------------
    // Confession
    // -------------------------------
    if (name === 'confession') {
        if (!confessionChannel)
            return interaction.reply({ content: 'Aucun salon de confession défini.', ephemeral: true });

        const confession = interaction.options.getString('description');
        const channel = client.channels.cache.get(confessionChannel);

        if (!channel || !channel.isTextBased())
            return interaction.reply({ content: 'Salon de confession invalide.', ephemeral: true });

        await channel.send({
            embeds: [{
                title: 'Confession anonyme',
                description: confession,
                timestamp: new Date(),
                footer: { text: 'Cette confession est anonyme.' }
            }]
        });

        await interaction.reply({ content: 'Votre confession a été envoyée.', ephemeral: true });

        if (logsChannel) {
            const logs = client.channels.cache.get(logsChannel);
            if (logs && logs.isTextBased()) {
                logs.send({
                    embeds: [{
                        title: 'CONFESSION LOG',
                        fields: [
                            { name: 'Auteur', value: interaction.user.tag },
                            { name: 'ID', value: interaction.user.id },
                            { name: 'Contenu', value: confession }
                        ],
                        timestamp: new Date()
                    }]
                });
            }
        }
        return;
    }

    // Owner only
    if (['setchannel','setlogs','bot-avatar','bot-name','bot-status','bot-activities'].includes(name) && !isOwner) {
        return interaction.reply({ content: 'Vous n\'avez pas la permission.', ephemeral: true });
    }

    // -------------------------------
    // SET CHANNEL
    // -------------------------------
    if (name === 'setchannel') {
        const salon = interaction.options.getChannel('salon');
        if (!salon.isTextBased()) return interaction.reply({ content: 'Vous devez choisir un salon textuel.', ephemeral: true });

        confessionChannel = salon.id;
        return interaction.reply(`Salon de confession défini : ${salon}`);
    }

    // -------------------------------
    // SET LOGS
    // -------------------------------
    if (name === 'setlogs') {
        const salon = interaction.options.getChannel('salon');
        if (!salon.isTextBased()) return interaction.reply({ content: 'Vous devez choisir un salon textuel.', ephemeral: true });

        logsChannel = salon.id;
        return interaction.reply(`Salon des logs défini : ${salon}`);
    }

    // -------------------------------
    // BOT AVATAR
    // -------------------------------
    if (name === 'bot-avatar') {
        const url = interaction.options.getString('url');
        await client.user.setAvatar(url);
        return interaction.reply('Avatar du bot mis à jour.');
    }

    // -------------------------------
    // BOT NAME
    // -------------------------------
    if (name === 'bot-name') {
        const nom = interaction.options.getString('nom');
        await client.user.setUsername(nom);
        return interaction.reply('Nom du bot mis à jour.');
    }

    // -------------------------------
    // BOT STATUS
    // -------------------------------
    if (name === 'bot-status') {
        const status = interaction.options.getString('status');
        client.user.setStatus(status);
        return interaction.reply('Status mis à jour.');
    }

    // -------------------------------
    // BOT ACTIVITIES
    // -------------------------------
    if (name === 'bot-activities') {
        const type = interaction.options.getString('type');
        const desc = interaction.options.getString('description');

        let activity = { type: ActivityType.Playing, name: desc };

        if (type === 'watching') activity.type = ActivityType.Watching;
        if (type === 'streaming') {
            activity.type = ActivityType.Streaming;
            activity.url = 'https://www.twitch.tv/byilhann';
        }
        if (type === 'compete') activity.type = ActivityType.Competing;

        client.user.setActivity(activity);
        return interaction.reply('Activité mise à jour.');
    }
});

client.on('ready', () => {
    console.log(`Bot connecté en tant que ${client.user.tag}`);
});

client.login(process.env.TOKEN);
