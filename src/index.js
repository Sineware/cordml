const {Client, GatewayIntentBits, InteractionType} = require('discord.js')
const express = require("express")
const { marked } = require('marked')
const pg = require('pg')
const xss = require("xss");

require('dotenv').config()

console.log("Starting CordML Server...")

let db;

const client = new Client({ intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ] })

client.on('ready', async () => {
    console.log(`Logged in as ${client?.user?.tag}!`)
    console.log("Connecting to Postgres...");

    db = new pg.Client()
    await db.connect()

    let getChannels = async () => {
        let channels = await db.query("SELECT * FROM cordml_channels")
        return channels.rows
    }
    let getChannelIds = async () => {
        let channels = await getChannels()
        return channels.map(channel => channel.channel_snowflake)
    }

    const app = express()
    app.set('view engine', 'ejs')
    app.use(express.static('public'))

    app.get('/', async function (req, res) {
        try {
            const channels = await getChannelIds();
            let c = []
            for (let channel of channels) {
                c.push(await client.channels.fetch(channel))
            }
            res.render('index', { c, xss })
        } catch(e) {
            console.log(e)
            res.send(e.message)
        }
    });

    app.get('/:channel', async function (req, res) {
        try {
            const channels = await getChannelIds();
            console.log(req.params.channel)
            if(!channels.includes(req.params.channel)) {
                res.send("This channel is not supported.")
                return
            }
            const channel = await client.channels.resolve(req.params.channel)
            const msgs = (await channel.messages.fetch()).toJSON()
            res.render('channel', { channel, msgs, marked, xss })
        } catch(e) {
            res.send(e.message)
        }
    })

    app.get('/:channel/:msg', async function (req, res) {
        console.log(req.params.channel + "/" + req.params.msg)
        try {
            const channels = await getChannelIds();
            if(!channels.includes(req.params.channel)) {
                res.send("This channel is not supported.")
                return
            }
            const channel = await client.channels.resolve(req.params.channel)
            const msg = await channel.messages.fetch(req.params.msg)
            //console.log(msg)
            let html = xss(marked.parse(msg.content))
            res.render('page', { channel, msg, html, marked, xss })
        } catch(e) {
            res.send(e.message)
        }
    })

    app.listen(3000, () => {
        console.log("Listening on port 3000");
    })
})

client.on('interactionCreate', async interaction => {
    if(interaction.type === InteractionType.ApplicationCommand) {
        try {
            await interaction.deferReply({ ephemeral: true });
            const { commandName } = interaction;
            console.log(interaction)
            if (commandName === 'createpage') {
                const channel = interaction.options.getChannel('channel')
                // Add channel to database
                await db.query("INSERT INTO cordml_channels (channel_snowflake, added_by, guild_snowflake) VALUES ($1,$2,$3)", [channel.id, interaction.user.id, channel.guild.id])
                await interaction.editReply({ content: 'You can now access that channel as a website at: https://pages.sineware.ca/' + channel.id, ephemeral: true });
            } else if(commandName === 'removepage') {
                // Remove channel from database
                const channel = interaction.options.getChannel('channel')
                await db.query("DELETE FROM cordml_channels WHERE channel_snowflake = $1", [channel.id])
                await interaction.editReply({ content: 'Removed the webpage for that channel!', ephemeral: true });
            }
        } catch(e) {
            console.log(e)
            interaction.editReply("The interaction failed: " + e.message)
        }
        
    }
});
// Remove all channels from database if the bot leaves the server
client.on('guildDelete', async guild => {
    try {
        await db.query("DELETE FROM cordml_channels WHERE guild_snowflake = $1", [guild.id])
    } catch(e) {
        console.log(e)
    }
});

// pages.sineware.ca/GUILD_ID/CHANNEL_ID/MESSAGE_ID
// rendered HTML and API
client.login(process.env.TOKEN)