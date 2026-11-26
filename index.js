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
    const userId =
      message.mentions.users.first()?.id ||
      args[2]?.match(/^\d{17,20}$/)?.[0];

    if (!userId) {
      return message.reply(
        "Usage: `~an trust @user` or `~an trust USER_ID`"
      );
    }

    if (userId === message.author.id) {
      return message.reply("❌ You cannot trust yourself.");
    }

    let trustedUser = message.mentions.users.first();

    if (trustedUser?.bot) {
      return message.reply("❌ You cannot trust bots.");
    }

    if (trusted.includes(userId)) {
      return message.reply("⚠️ This member is already trusted.");
    }

    trusted.push(userId);
    saveAntiNukeData();

    return message.reply(
      `<@${userId}> you are now added to the trust team`
    );
  }


if (action === "untrust") {
  const userId =
    message.mentions.users.first()?.id ||
    args[2]?.match(/^\d{17,20}$/)?.[0];

  if (!userId) {
    return message.reply(
      "Usage: `~an untrust @user` or `~an untrust USER_ID`"
    );
  }

  const trustedUser = await client.users.fetch(userId).catch(() => null);

  if (!trustedUser) {
    return message.reply("❌ Could not find that Discord user.");
  }

  if (!trusted.includes(userId)) {
    return message.reply("⚠️ This member is not on the trust team.");
  }

  antiNukeData.trusted[guildId] =
    trusted.filter(id => id !== userId);

  saveAntiNukeData();

  const embed = new EmbedBuilder()
    .setColor(0x8B0000)
    .setTitle("ZOMB | TRUST SYSTEM")
    .setDescription(
      `**${trustedUser.username}** has been removed from the trust team.`
    )
    .setFooter({ text: "ZOMB ANTINUKE" })
    .setTimestamp();

  return message.reply({ embeds: [embed] });
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

  re
return message.reply({
  embeds: [
    new EmbedBuilder()
      .setColor(0x8B0000)
      .setTitle("ZOMB | TRUST SYSTEM")
      .setDescription(
        `**${trustedUser.username}** you are now added to the trust team.`
      )
      .setFooter({ text: "ZOMB ANTINUKE" })
      .setTimestamp()
  ]
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
