const {Client, GatewayIntentBits, InteractionType, MessageFlags} = require('discord.js')
const express = require("express")
const { marked } = require('marked')
const pg = require('pg')
const xss = require("xss");

require('dotenv').config()

console.log("Starting CordML Server...")

let db;
let channelPageCache = new Map();
let channelPageCacheLoading = new Map();
const MESSAGES_PER_PAGE = 5;

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

    app.get('/sitemap.xml', async (req, res) => {
        try {
            const channels = await getChannels();
            let sitemap = '<?xml version="1.0" encoding="UTF-8"?>\n';
            sitemap += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
            
            // Add home page
            sitemap += `  <url>\n    <loc>${process.env.BASE_URL}</loc>\n    <changefreq>daily</changefreq>\n  </url>\n`;
            
            // Add channel pages
            for (const channel of channels) {
                sitemap += `  <url>\n    <loc>${process.env.BASE_URL}/${channel.channel_snowflake}</loc>\n    <changefreq>hourly</changefreq>\n  </url>\n`;
            }
            
            sitemap += '</urlset>';
            
            res.header('Content-Type', 'application/xml');
            res.send(sitemap);
        } catch(e) {
            res.status(500).send(e.message);
        }
    });

    app.get('/:channel', async function (req, res) {
        try {
            const channels = await getChannelIds();
            const page = parseInt(req.query.page) || 1; // Get page from query parameter
            
            if(!channels.includes(req.params.channel)) {
                res.send("This channel is not supported.")
                return
            }
            
            let channel = await client.channels.fetch(req.params.channel)
            
            if(!channelPageCache.has(req.params.channel)) {
                if (channelPageCacheLoading.get(req.params.channel) == "loading") {
                    res.send("CordML is still updating this page, please wait a few seconds and refresh.");
                    return;
                }
                res.send("CordML is updating this page, please wait a few seconds and refresh.");
                channelPageCacheLoading.set(req.params.channel, "loading")
                let messages = await fetchAllMessages(channel)
                channelPageCache.set(req.params.channel, messages)
                channelPageCacheLoading.set(req.params.channel, "done")
                return;
            } else {
                // Update the cache in the background
                if(channelPageCacheLoading.get(req.params.channel) != "loading") {
                    channelPageCacheLoading.set(req.params.channel, "loading")
                    fetchAllMessages(channel).then(messages => {
                        try {
                            channelPageCache.set(req.params.channel, messages)
                            channelPageCacheLoading.set(req.params.channel, "done")
                        } catch(e) {}
                    });
                }
            }
            
            let msgs = channelPageCache.get(req.params.channel)
            
            // Calculate pagination
            const totalMessages = msgs.length;
            const totalPages = Math.ceil(totalMessages / MESSAGES_PER_PAGE);
            const startIndex = (page - 1) * MESSAGES_PER_PAGE;
            const endIndex = startIndex + MESSAGES_PER_PAGE;
            const paginatedMsgs = msgs.slice(startIndex, endIndex);
            
            res.render('channel', { 
                channel, 
                msgs: paginatedMsgs, 
                marked, 
                xss,
                pagination: {
                    current: page,
                    total: totalPages
                }
            })
        } catch(e) {
            res.send(e.message)
        }
    });

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
    });

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

async function fetchAllMessages(channel) {
    let messages = [];
  
    // Create message pointer
    let message = await channel.messages
      .fetch({ limit: 1 })
      .then(messagePage => (messagePage.size === 1 ? messagePage.at(0) : null));
    messages.push(message);
  
    while (message) {
      let messagePage = await channel.messages.fetch({ limit: 100, before: message.id })
      messagePage.forEach(msg => messages.push(msg));
      // Update our message pointer to be last message in page of messages
      message = 0 < messagePage.size ? messagePage.at(messagePage.size - 1) : null;
    }
  
    console.log("Fetched " + messages.length + " messages.");  // Print all messages
    return messages;
}