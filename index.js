
const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder
} = require("discord.js");

const client = new Client({
  intents: []
});

const commands = [
  new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Check ZOMB's response time")
    .setIntegrationTypes(0, 1)
    .setContexts(0, 1, 2),

  new SlashCommandBuilder()
    .setName("help")
    .setDescription("View ZOMB commands")
    .setIntegrationTypes(0, 1)
    .setContexts(0, 1, 2)
].map(command => command.toJSON());

const rest = new REST({ version: "10" })
  .setToken(process.env.DISCORD_TOKEN);

async function registerCommands() {
  await rest.put(
    Routes.applicationCommands(process.env.CLIENT_ID),
    { body: commands }
  );
  console.log("ZOMB commands registered!");
}

client.once("ready", () => {
  console.log(`ZOMB online as ${client.user.tag}`);
});

client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === "ping") {
    await interaction.reply("ZOMB is online. ⚡");
  }

  if (interaction.commandName === "help") {
    await interaction.reply(
      "**ZOMB COMMANDS**\n\n/ping — Check bot status\n/help — View commands"
    );
  }
});

async function start() {
  await registerCommands();
  await client.login(process.env.DISCORD_TOKEN);
}

start().catch(console.error);
