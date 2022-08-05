const { SlashCommandBuilder } = require('@discordjs/builders');
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v9');
require('dotenv').config()

const token = process.env.TOKEN
const clientId = process.env.CLIENTID

const commands = [
	new SlashCommandBuilder()
    .setName('createpage')
    .setDescription('Create a new webpage from the messages in a channel! (Registers Channel ID)')
    .addChannelOption(option => option.setName('channel').setDescription("The channel to create a webpage from").setRequired(true)),
    new SlashCommandBuilder()
    .setName('removepage')
    .setDescription('Removes the webpage that represents a channel (Deregisters Channel ID)')
    .addChannelOption(option => option.setName('channel').setDescription("The channel that has a webpage").setRequired(true)),
]
	.map(command => command.toJSON());

const rest = new REST({ version: '9' }).setToken(token);

rest.put(Routes.applicationCommands(clientId), { body: commands })
	.then(() => console.log('Successfully registered application commands.'))
	.catch(console.error);
