const fs = require("fs");
const path = require("path");

const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder
} = require("discord.js");
const DATA_FILE = process.env.ANTINUKE_FILE ||
  path.join(__dirname, "antinuke.json");
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildWebhooks
  ]
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
let antiNukeData = {
  trusted: {},
  enabled: {}
};

function loadAntiNukeData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      antiNukeData = JSON.parse(
        fs.readFileSync(DATA_FILE, "utf8")
      );
    }
  } catch (error) {
    console.error("Anti-nuke data loading failed:", error);
  }
}

function saveAntiNukeData() {
  fs.writeFileSync(
    DATA_FILE,
    JSON.stringify(antiNukeData, null, 2)
  );
}

loadAntiNukeData();
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

client.on("messageCreate", async message => {
  if (!message.guild || message.author.bot) return;

  const args = message.content.trim().split(/\s+/);
  const command = args[0].toLowerCase();

  if (command !== "~an" && command !== "~antinuke") return;

  // Only the server owner can manage anti-nuke
  if (message.author.id !== message.guild.ownerId) {
    return message.reply("❌ Only the server owner can manage ZOMB's anti-nuke system.");
  }

  const action = (args[1] || "").toLowerCase();
  const target = message.mentions.users.first();

  const guildId = message.guild.id;

  if (!Array.isArray(antiNukeData.trusted[guildId])) {
    antiNukeData.trusted[guildId] = [];
  }

  const trusted = antiNukeData.trusted[guildId];

  if (action === "trust") {
    if (!target) {
      return message.reply("Usage: `~an trust @user`");
    }

    if (target.bot || target.id === message.author.id) {
      return message.reply("❌ You cannot trust bots or yourself.");
    }

    if (trusted.includes(target.id)) {
      return message.reply("⚠️ This member is already trusted.");
    }

    trusted.push(target.id);
    saveAntiNukeData();

    return message.reply(`✅ ${target.tag} has been added to ZOMB's trusted team.`);
  }

  if (action === "untrust") {
    if (!target) {
      return message.reply("Usage: `~an untrust @user`");
    }

    if (!trusted.includes(target.id)) {
      return message.reply("❌ This member is not trusted.");
    }

    antiNukeData.trusted[guildId] =
      trusted.filter(id => id !== target.id);

    saveAntiNukeData();

    return message.reply(`✅ ${target.tag} has been removed from the trusted team.`);
  }

  if (action === "trustlist") {
    if (trusted.length === 0) {
      return message.reply("The ZOMB trusted team is currently empty.");
    }

    return message.reply(
      "**ZOMB TRUSTED TEAM**\n" +
      trusted.map(id => `• <@${id}>`).join("\n")
    );
  }

  return message.reply(
    "**ZOMB ANTINUKE COMMANDS**\n\n" +
    "`~an trust @user` — Trust a member\n" +
    "`~an untrust @user` — Remove a trusted member\n" +
    "`~an trustlist` — View trusted members"
  );
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
