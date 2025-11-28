import {
    Client,
    GatewayIntentBits,
    Partials,
    SlashCommandBuilder,
    EmbedBuilder,
    ActivityType,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} from "discord.js";

import sqlite3 from "sqlite3";
import dotenv from "dotenv";
dotenv.config();

const TOKEN = process.env.TOKEN;
const OWNERS = process.env.OWNERS.split(",");

/* ---------------------------------------------------------
   SQLITE
--------------------------------------------------------- */
const db = new sqlite3.Database("./confessions.db");

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS confessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT,
        content TEXT,
        date TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS votes (
        message_id TEXT,
        user_id TEXT,
        stars INTEGER
    )`);
});

/* ---------------------------------------------------------
   LOAD SETTINGS
--------------------------------------------------------- */
let confessionChannel = null;
let logsChannel = null;

db.get(
    `SELECT value FROM settings WHERE key = "confessionChannel"`,
    (err, row) => {
        if (!err && row) confessionChannel = row.value;
    }
);

db.get(
    `SELECT value FROM settings WHERE key = "logsChannel"`,
    (err, row) => {
        if (!err && row) logsChannel = row.value;
    }
);

/* ---------------------------------------------------------
   HELPERS
--------------------------------------------------------- */
const EMBED_COLOR = 0xFFFF00; // Jaune vif

function makeEmbed(description) {
    return new EmbedBuilder().setColor(EMBED_COLOR).setDescription(description);
}

function noPermEmbed(userId) {
    return makeEmbed(
        `\`\`⚙️\`\` <@${userId}> \`(${userId})\` vous n'avez pas l'autorisation nécéssaire pour utilliser la commande`
    );
}

function buildLeaderboardButtons() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("lb_prev")
            .setLabel("⬅")
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId("lb_next")
            .setLabel("➡")
            .setStyle(ButtonStyle.Primary)
    );
}

/**
 * Récupère les entrées du leaderboard pour un salon donné.
 * Retourne une liste triée par moyenne d'étoiles desc, puis nombre de votes desc.
 */
async function getLeaderboardEntries(channel) {
    return new Promise((resolve, reject) => {
        db.all(
            `SELECT message_id, COUNT(*) AS votes, AVG(stars) AS avgStars
             FROM votes
             GROUP BY message_id
             HAVING votes > 0
             ORDER BY avgStars DESC, votes DESC`,
            [],
            async (err, rows) => {
                if (err) return reject(err);
                if (!rows || rows.length === 0) return resolve([]);

                const entries = [];
                for (const row of rows) {
                    try {
                        const msg = await channel.messages.fetch(row.message_id);
                        if (!msg) continue;
                        const createdTs = Math.floor(msg.createdTimestamp / 1000);
                        entries.push({
                            messageId: row.message_id,
                            votes: Number(row.votes) || 0,
                            avgStars: Number(row.avgStars) || 0,
                            createdTs
                        });
                    } catch {
                        // message introuvable => on ignore cette entrée
                    }
                }
                resolve(entries);
            }
        );
    });
}

/**
 * Construit l'embed de leaderboard pour une page donnée.
 */
function buildLeaderboardEmbed(guild, channel, entries, page, perPage) {
    const total = entries.length;
    const totalPages = Math.max(1, Math.ceil(total / perPage));
    const currentPage = Math.min(Math.max(page, 0), totalPages - 1);

    const start = currentPage * perPage;
    const pageEntries = entries.slice(start, start + perPage);

    let desc = "";
    if (pageEntries.length === 0) {
        desc = "``ℹ️`` Aucune confession notée pour le moment.";
    } else {
        let rank = start + 1;
        for (const e of pageEntries) {
            const starsCount = Math.min(Math.max(Math.round(e.avgStars), 1), 5);
            const starsStr = "⭐".repeat(starsCount);
            const avgStr = e.avgStars.toFixed(1);
            const url = `https://discord.com/channels/${guild.id}/${channel.id}/${e.messageId}`;

            desc += `**${rank}**) ${starsStr} (${avgStr}) — ${e.votes} votes\n`;
            desc += `ID : \`${e.messageId}\`\n`;
            desc += `Date : <t:${e.createdTs}:F>\n`;
            desc += `[Lire la confession](${url})\n\n`;
            rank++;
        }
    }

    return new EmbedBuilder()
        .setColor(EMBED_COLOR)
        .setTitle(`${guild.name} #Leaderboard Confession !`)
        .setDescription(desc)
        .setFooter({ text: `Page ${currentPage + 1}/${totalPages}` })
        .setTimestamp();
}

/* ---------------------------------------------------------
   SLASH COMMANDS
--------------------------------------------------------- */
const commands = [
    new SlashCommandBuilder()
        .setName("confession")
        .setDescription("Envoyer une confession anonyme.")
        .addStringOption(o =>
            o.setName("description").setDescription("Votre confession").setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName("setchannel")
        .setDescription("Définir le salon des confessions (OWNER)")
        .addChannelOption(o =>
            o.setName("salon").setDescription("Salon cible").setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName("setlogs")
        .setDescription("Définir le salon des logs (OWNER)")
        .addChannelOption(o =>
            o.setName("salon").setDescription("Salon logs").setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName("bot-avatar")
        .setDescription("Changer l’avatar du bot (OWNER)")
        .addStringOption(o =>
            o.setName("url").setDescription("Lien de l'image").setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName("bot-name")
        .setDescription("Changer le nom du bot (OWNER)")
        .addStringOption(o =>
            o.setName("nom").setDescription("Nouveau nom").setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName("bot-status")
        .setDescription("Changer le status du bot (OWNER)")
        .addStringOption(o =>
            o.setName("type")
                .setDescription("Statut")
                .setRequired(true)
                .addChoices(
                    { name: "online", value: "online" },
                    { name: "idle", value: "idle" },
                    { name: "dnd", value: "dnd" },
                    { name: "invisible", value: "invisible" }
                )
        ),

    new SlashCommandBuilder()
        .setName("bot-activities")
        .setDescription("Changer l’activité du bot (OWNER)")
        .addStringOption(o =>
            o.setName("type")
                .setDescription("Type d’activité")
                .setRequired(true)
                .addChoices(
                    { name: "Playing", value: "playing" },
                    { name: "Watching", value: "watching" },
                    { name: "Streaming", value: "streaming" },
                    { name: "Competing", value: "competing" }
                )
        )
        .addStringOption(o =>
            o.setName("description").setDescription("Texte de l’activité").setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName("delete-confession")
        .setDescription("Supprimer une confession via l'ID du message (OWNER)")
        .addStringOption(o =>
            o.setName("id").setDescription("ID du message de confession").setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName("top-confession")
        .setDescription("Afficher le classement des confessions les mieux notées")
];

/* ---------------------------------------------------------
   CLIENT
--------------------------------------------------------- */
const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
    partials: [Partials.Channel]
});

// Map pour gérer les leaderboards actifs : msgId -> { channelId, page, perPage }
const leaderboards = new Map();

client.once("ready", async () => {
    await client.application.commands.set(commands);
    console.log(`✅ ${client.user.tag} prêt (Confession Bot)`);

    // Rafraîchissement automatique des leaderboards toutes les 15s
    setInterval(async () => {
        for (const [msgId, info] of leaderboards.entries()) {
            try {
                const channel = client.channels.cache.get(info.channelId);
                if (!channel || !channel.isTextBased()) continue;

                let message;
                try {
                    message = await channel.messages.fetch(msgId);
                } catch {
                    // Si Discord rate un fetch, on réessaie au prochain tick
                    continue;
                }

                const guild = message.guild;
                if (!guild) continue;

                const entries = await getLeaderboardEntries(channel);

                const embed = buildLeaderboardEmbed(
                    guild,
                    channel,
                    entries,
                    info.page,
                    info.perPage
                );

                const totalPages = Math.ceil(entries.length / info.perPage);
                const row = totalPages > 1 ? buildLeaderboardButtons() : null;

                await message
                    .edit({
                        embeds: [embed],
                        components: row ? [row] : []
                    })
                    .catch(() => {});
            } catch (e) {
                console.error("Leaderboard refresh error:", e);
            }
        }
    }, 15000);
});

/* ---------------------------------------------------------
   INTERACTIONS
--------------------------------------------------------- */
client.on("interactionCreate", async interaction => {
    // BOUTONS
    if (interaction.isButton()) {
        const customId = interaction.customId;

        // Votes
        if (customId.startsWith("vote_")) {
            const stars = parseInt(customId.split("_")[1], 10);
            const messageId = interaction.message.id;
            const userId = interaction.user.id;

            db.get(
                `SELECT stars FROM votes WHERE message_id = ? AND user_id = ?`,
                [messageId, userId],
                (err, row) => {
                    if (err) {
                        console.error(err);
                        return interaction.reply({
                            embeds: [
                                makeEmbed(
                                    "``⚙️`` Une erreur est survenue lors de l'enregistrement du vote."
                                )
                            ],
                            ephemeral: true
                        });
                    }

                    if (row) {
                        return interaction.reply({
                            embeds: [
                                makeEmbed(
                                    "``⚠️`` Tu as déjà voté pour cette confession."
                                )
                            ],
                            ephemeral: true
                        });
                    }

                    db.run(
                        `INSERT INTO votes (message_id, user_id, stars) VALUES (?, ?, ?)`,
                        [messageId, userId, stars],
                        insertErr => {
                            if (insertErr) {
                                console.error(insertErr);
                                return interaction.reply({
                                    embeds: [
                                        makeEmbed(
                                            "``⚙️`` Impossible d'enregistrer ton vote pour le moment."
                                        )
                                    ],
                                    ephemeral: true
                                });
                            }

                            return interaction.reply({
                                embeds: [makeEmbed("``⭐`` Merci de ton vote !")],
                                ephemeral: true
                            });
                        }
                    );
                }
            );
            return;
        }

        // Pagination leaderboard
        if (customId === "lb_prev" || customId === "lb_next") {
            const msgId = interaction.message.id;
            const info = leaderboards.get(msgId);
            if (!info) {
                return interaction.reply({
                    embeds: [makeEmbed("``⚙️`` Ce leaderboard a expiré.")],
                    ephemeral: true
                });
            }

            const channel = client.channels.cache.get(info.channelId);
            if (!channel || !channel.isTextBased()) {
                return interaction.reply({
                    embeds: [makeEmbed("``⚙️`` Salon invalide pour ce leaderboard.")],
                    ephemeral: true
                });
            }

            const guild = interaction.guild;
            if (!guild) {
                return interaction.reply({
                    embeds: [makeEmbed("``⚙️`` Impossible de trouver le serveur.")],
                    ephemeral: true
                });
            }

            const entries = await getLeaderboardEntries(channel);
            if (!entries.length) {
                return interaction.reply({
                    embeds: [makeEmbed("``ℹ️`` Aucune confession notée pour le moment.")],
                    ephemeral: true
                });
            }

            const totalPages = Math.max(
                1,
                Math.ceil(entries.length / info.perPage)
            );

            if (totalPages <= 1) {
                return interaction.reply({
                    embeds: [makeEmbed("``ℹ️`` Il n’y a qu’une seule page.")],
                    ephemeral: true
                });
            }

            if (customId === "lb_prev") {
                info.page = (info.page - 1 + totalPages) % totalPages;
            } else {
                info.page = (info.page + 1) % totalPages;
            }

            leaderboards.set(msgId, info);

            const embed = buildLeaderboardEmbed(
                guild,
                channel,
                entries,
                info.page,
                info.perPage
            );
            const row = totalPages > 1 ? buildLeaderboardButtons() : null;

            return interaction.update({
                embeds: [embed],
                components: row ? [row] : []
            });
        }

        return;
    }

    // COMMANDES
    if (!interaction.isChatInputCommand()) return;
    const name = interaction.commandName;

    // OWNER ONLY pour certaines commandes (sauf top-confession)
    if (
        [
            "setchannel",
            "setlogs",
            "bot-avatar",
            "bot-name",
            "bot-status",
            "bot-activities",
            "delete-confession"
        ].includes(name) &&
        !OWNERS.includes(interaction.user.id)
    ) {
        return interaction.reply({
            embeds: [noPermEmbed(interaction.user.id)],
            ephemeral: true
        });
    }

    /* ---------------------- /confession ---------------------- */
    if (name === "confession") {
        if (!confessionChannel) {
            return interaction.reply({
                embeds: [makeEmbed("``⚙️`` Aucun salon configuré.")],
                ephemeral: true
            });
        }

        const confession = interaction.options.getString("description");
        const channel = client.channels.cache.get(confessionChannel);

        if (!channel?.isTextBased()) {
            return interaction.reply({
                embeds: [makeEmbed("``⚙️`` Salon invalide.")],
                ephemeral: true
            });
        }

        const timestamp = Math.floor(Date.now() / 1000);

        const confessionEmbed = new EmbedBuilder()
            .setColor(EMBED_COLOR)
            .setTitle("💌 Nouvelle Confession")
            .setDescription(confession)
            .setFooter({ text: "Cette confession est totalement anonyme." })
            .setTimestamp();

        const voteRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId("vote_1")
                .setLabel("⭐")
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId("vote_2")
                .setLabel("⭐⭐")
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId("vote_3")
                .setLabel("⭐⭐⭐")
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId("vote_4")
                .setLabel("⭐⭐⭐⭐")
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId("vote_5")
                .setLabel("⭐⭐⭐⭐⭐")
                .setStyle(ButtonStyle.Primary)
        );

        const sent = await channel.send({
            embeds: [confessionEmbed],
            components: [voteRow]
        });

        db.run(
            `INSERT INTO confessions (user_id, content, date) VALUES (?, ?, ?)`,
            [interaction.user.id, confession, new Date().toISOString()]
        );

        if (logsChannel) {
            const logs = client.channels.cache.get(logsChannel);
            if (logs?.isTextBased()) {
                const logEmbed = new EmbedBuilder()
                    .setColor(EMBED_COLOR)
                    .setTitle("📝 Confession Log")
                    .setDescription(
                        `\`\`🙍\`\` Auteur : <@${interaction.user.id}> \`(${interaction.user.id})\`\n` +
                            `\`\`📄\`\` Contenu : ${confession}\n` +
                            `\`\`⏱️\`\` Date : <t:${timestamp}:F>\n` +
                            `\`\`🆔\`\` Message ID : \`${sent.id}\``
                    )
                    .setFooter({
                        text: "Log automatique du système de confessions."
                    })
                    .setTimestamp();

                logs.send({ embeds: [logEmbed] });
            }
        }

        return interaction.reply({
            embeds: [makeEmbed("``✔️`` Confession envoyée.")],
            ephemeral: true
        });
    }

    /* ---------------------- /setchannel ---------------------- */
    if (name === "setchannel") {
        const salon = interaction.options.getChannel("salon");

        if (!salon.isTextBased()) {
            return interaction.reply({
                embeds: [makeEmbed("``⚙️`` Salon textuel requis.")],
                ephemeral: true
            });
        }

        confessionChannel = salon.id;

        db.run(
            `INSERT OR REPLACE INTO settings (key, value) VALUES ("confessionChannel", ?)`,
            [salon.id]
        );

        return interaction.reply({
            embeds: [makeEmbed(`\`\`✔️\`\` Salon des confessions défini : ${salon}`)]
        });
    }

    /* ---------------------- /setlogs ---------------------- */
    if (name === "setlogs") {
        const salon = interaction.options.getChannel("salon");

        if (!salon.isTextBased()) {
            return interaction.reply({
                embeds: [makeEmbed("``⚙️`` Salon textuel requis.")],
                ephemeral: true
            });
        }

        logsChannel = salon.id;

        db.run(
            `INSERT OR REPLACE INTO settings (key, value) VALUES ("logsChannel", ?)`,
            [salon.id]
        );

        return interaction.reply({
            embeds: [makeEmbed(`\`\`✔️\`\` Salon des logs défini : ${salon}`)]
        });
    }

    /* ---------------------- /bot-avatar ---------------------- */
    if (name === "bot-avatar") {
        const url = interaction.options.getString("url");

        try {
            await client.user.setAvatar(url);
            return interaction.reply({
                embeds: [
                    makeEmbed(
                        `\`\`💊\`\` L'avatar du bot <@${client.user.id}> \`(${client.user.id})\` à bien été changé avec succès !`
                    )
                ]
            });
        } catch (err) {
            console.error(err);
            return interaction.reply({
                embeds: [makeEmbed("``⚙️`` Impossible de changer l’avatar.")],
                ephemeral: true
            });
        }
    }

    /* ---------------------- /bot-name ---------------------- */
    if (name === "bot-name") {
        const nom = interaction.options.getString("nom");

        try {
            await client.user.setUsername(nom);
            return interaction.reply({
                embeds: [
                    makeEmbed(
                        `\`\`🍀\`\` Le nom du bot <@${client.user.id}> \`(${client.user.id})\` à bien été changé en **${nom}**`
                    )
                ]
            });
        } catch (err) {
            console.error(err);
            return interaction.reply({
                embeds: [makeEmbed("``⚙️`` Impossible de changer le nom.")],
                ephemeral: true
            });
        }
    }

    /* ---------------------- /bot-status ---------------------- */
    if (name === "bot-status") {
        const status = interaction.options.getString("type");

        try {
            await client.user.setStatus(status);
            return interaction.reply({
                embeds: [
                    makeEmbed(
                        `\`\`🦋\`\` Le status du bot <@${client.user.id}> \`(${client.user.id})\` à bien été changé en **${status}**`
                    )
                ]
            });
        } catch (err) {
            console.error(err);
            return interaction.reply({
                embeds: [makeEmbed("``⚙️`` Impossible de changer le status.")],
                ephemeral: true
            });
        }
    }

    /* ---------------------- /bot-activities ---------------------- */
    if (name === "bot-activities") {
        const type = interaction.options.getString("type");
        const desc = interaction.options.getString("description");

        let actType;
        let url;

        switch (type) {
            case "playing":
                actType = ActivityType.Playing;
                break;
            case "watching":
                actType = ActivityType.Watching;
                break;
            case "streaming":
                actType = ActivityType.Streaming;
                url = "https://twitch.tv/serial";
                break;
            case "competing":
                actType = ActivityType.Competing;
                break;
            default:
                actType = ActivityType.Playing;
        }

        try {
            if (type === "streaming") {
                await client.user.setActivity(desc, { type: actType, url });
            } else {
                await client.user.setActivity(desc, { type: actType });
            }

            return interaction.reply({
                embeds: [
                    makeEmbed(
                        `\`\`🍦\`\` L'activité du bot <@${client.user.id}> \`(${client.user.id})\` à bien été changé en **${type}**`
                    )
                ]
            });
        } catch (err) {
            console.error(err);
            return interaction.reply({
                embeds: [makeEmbed("``⚙️`` Impossible de changer l’activité.")],
                ephemeral: true
            });
        }
    }

    /* ---------------------- /delete-confession ---------------------- */
    if (name === "delete-confession") {
        const messageId = interaction.options.getString("id");

        if (!confessionChannel) {
            return interaction.reply({
                embeds: [makeEmbed("``⚙️`` Aucun salon de confession défini.")],
                ephemeral: true
            });
        }

        const channel = client.channels.cache.get(confessionChannel);
        if (!channel?.isTextBased()) {
            return interaction.reply({
                embeds: [makeEmbed("``⚙️`` Salon de confession invalide.")],
                ephemeral: true
            });
        }

        try {
            const msg = await channel.messages.fetch(messageId);
            await msg.delete();

            db.run(`DELETE FROM votes WHERE message_id = ?`, [messageId]);

            if (logsChannel) {
                const logs = client.channels.cache.get(logsChannel);
                if (logs?.isTextBased()) {
                    const ts = Math.floor(Date.now() / 1000);
                    const logEmbed = new EmbedBuilder()
                        .setColor(EMBED_COLOR)
                        .setTitle("🗑️ Confession supprimée")
                        .setDescription(
                            `\`\`🧹\`\` Supprimée par : <@${interaction.user.id}> \`(${interaction.user.id})\`\n` +
                                `\`\`🆔\`\` Message ID : \`${messageId}\`\n` +
                                `\`\`⏱️\`\` Date : <t:${ts}:F>`
                        )
                        .setTimestamp();

                    logs.send({ embeds: [logEmbed] });
                }
            }

            return interaction.reply({
                embeds: [makeEmbed("``✔️`` Confession supprimée avec succès.")],
                ephemeral: true
            });
        } catch (err) {
            console.error(err);
            return interaction.reply({
                embeds: [makeEmbed("``⚙️`` Impossible de trouver ou supprimer ce message.")],
                ephemeral: true
            });
        }
    }

    /* ---------------------- /top-confession ---------------------- */
    if (name === "top-confession") {
        if (!confessionChannel) {
            return interaction.reply({
                embeds: [makeEmbed("``⚙️`` Aucun salon de confession défini.")],
                ephemeral: true
            });
        }

        const channel = client.channels.cache.get(confessionChannel);
        if (!channel?.isTextBased()) {
            return interaction.reply({
                embeds: [makeEmbed("``⚙️`` Salon de confession invalide.")],
                ephemeral: true
            });
        }

        const guild = interaction.guild;
        if (!guild) {
            return interaction.reply({
                embeds: [makeEmbed("``⚙️`` Impossible de trouver le serveur.")],
                ephemeral: true
            });
        }

        const entries = await getLeaderboardEntries(channel);
        if (!entries.length) {
            return interaction.reply({
                embeds: [makeEmbed("``ℹ️`` Aucune confession notée pour le moment.")],
                ephemeral: true
            });
        }

        const perPage = 5;
        const page = 0;
        const embed = buildLeaderboardEmbed(guild, channel, entries, page, perPage);
        const totalPages = Math.ceil(entries.length / perPage);
        const row = totalPages > 1 ? [buildLeaderboardButtons()] : [];

        const msg = await interaction.reply({
            embeds: [embed],
            components: row,
            fetchReply: true
        });

        leaderboards.set(msg.id, {
            channelId: channel.id,
            page,
            perPage
        });
    }
});

/* ---------------------------------------------------------
   LOGIN
--------------------------------------------------------- */
client.login(TOKEN);
