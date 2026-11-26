
const fs = require("fs");
const path = require("path");

const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  AuditLogEvent
} = require("discord.js");

const DATA_FILE = process.env.ANTINUKE_FILE ||
  path.join(__dirname, "antinuke.json");

const LOG_CHANNEL_ID = "1575507474709090446";

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

// SLASH COMMANDS
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

// DATA STORAGE
let antiNukeData = {
  trusted: {},
  enabled: {},
  logs: {}
};

function loadAntiNukeData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const saved = JSON.parse(
        fs.readFileSync(DATA_FILE, "utf8")
      );

      antiNukeData = {
        trusted: saved.trusted || {},
        enabled: saved.enabled || {},
        logs: saved.logs || {}
      };
    }
  } catch (error) {
    console.error("[ZOMB DATA ERROR]", error);
  }
}

function saveAntiNukeData() {
  try {
    fs.mkdirSync(path.dirname(DATA_FILE), {
      recursive: true
    });

    fs.writeFileSync(
      DATA_FILE,
      JSON.stringify(antiNukeData, null, 2)
    );
  } catch (error) {
    console.error("[ZOMB SAVE ERROR]", error);
  }
}

loadAntiNukeData();

// ANTI-NUKE LIMITS
const ANTI_NUKE_LIMITS = {
  channelDelete: {
    max: 3,
    windowMs: 10000
  },

  channelCreate: {
    max: 5,
    windowMs: 10000
  }
};

const actionTracker = new Map();
const processedAuditEntries = new Set();
// ANTI-NUKE LOGGING
async function sendAntiNukeLog(guild, title, description) {
  try {
    const channelId = antiNukeData.logs?.[guild.id];

    if (!channelId) return;

    const logChannel = await guild.channels
      .fetch(channelId)
      .catch(() => null);

    if (!logChannel || !logChannel.isTextBased()) return;

    const embed = new EmbedBuilder()
      .setColor(0x8B0000)
      .setTitle(`ZOMB | ${title}`)
      .setDescription(description)
      .setFooter({
        text: "ZOMB ANTINUKE SECURITY"
      })
      .setTimestamp();

    await logChannel.send({
      embeds: [embed]
    });

  } catch (error) {
    console.error("[ZOMB LOG ERROR]", error);
  }
}

async function checkAntiNuke(
  guild,
  targetId,
  actionType,
  actionName
) {
  try {
    if (antiNukeData.enabled[guild.id] !== true) return;

    await new Promise(resolve =>
      setTimeout(resolve, 1500)
    );

    const logs = await guild.fetchAuditLogs({
      type: actionType,
      limit: 10
    });

    const entry = logs.entries.find(log =>
      log.target?.id === targetId &&
      log.executor &&
      Date.now() - log.createdTimestamp < 15000 &&
      !processedAuditEntries.has(log.id)
    );

    if (!entry) return;

    processedAuditEntries.add(entry.id);

    // Keep the processed-entry list limited
    if (processedAuditEntries.size > 1000) {
      const oldest = processedAuditEntries.values().next().value;
      processedAuditEntries.delete(oldest);
    }

    const executorId = entry.executor.id;

    if (executorId === guild.ownerId) return;
    if (executorId === client.user.id) return;

    const trustedUsers =
      antiNukeData.trusted[guild.id] || [];

    if (trustedUsers.includes(executorId)) return;

    const limit = ANTI_NUKE_LIMITS[actionName];
    if (!limit) return;

    const key = `${guild.id}:${executorId}:${actionName}`;
    const now = Date.now();

    const timestamps = (actionTracker.get(key) || [])
      .filter(time => now - time < limit.windowMs);

    timestamps.push(now);
    actionTracker.set(key, timestamps);

    if (timestamps.length < limit.max) return;

    actionTracker.set(key, []);

    const reason =
      `ZOMB Anti-Nuke: Excessive ${actionName} activity`;

    const member = await guild.members.fetch(executorId)
      .catch(() => null);

    if (!member || member.user.bot) return;

    let roleResponse = "No manageable roles removed";
    let banResponse = "Ban not attempted";

    try {
      const removableRoles = member.roles.cache
        .filter(role =>
          role.id !== guild.id && role.editable
        )
        .map(role => role.id);

      if (removableRoles.length > 0) {
        await member.roles.remove(removableRoles, reason);
        roleResponse = "Manageable roles removed";
      }
    } catch (error) {
      console.error("[ZOMB ROLE REMOVAL ERROR]", error);
      roleResponse = "Role removal failed";
    }

    try {
      await guild.members.ban(executorId, { reason });
      banResponse = "Permanent ban successful";
    } catch (error) {
      console.error("[ZOMB BAN ERROR]", error);
      banResponse = "Ban failed - check permissions";
    }

    await sendAntiNukeLog(
      guild,
      "ATTACK DETECTED",
      `**Attacker:** ${entry.executor.username}\n` +
      `**User ID:** ${executorId}\n` +
      `**Action:** ${actionName}\n` +
      `**Threshold:** ${limit.max} actions in 10 seconds\n` +
      `**Role Removal:** ${roleResponse}\n` +
      `**Ban Status:** ${banResponse}`
    );

    console.warn(
      `[ZOMB ANTINUKE] ${entry.executor.username} triggered protection in ${guild.name}`
    );

  } catch (error) {
    console.error("[ZOMB ANTI-NUKE ERROR]", error);
  }
}


// CHANNEL DELETION DETECTION
client.on("channelDelete", channel => {
  if (!channel.guild) return;

  checkAntiNuke(
    channel.guild,
    channel.id,
    AuditLogEvent.ChannelDelete,
    "channelDelete"
  );
});

// CHANNEL CREATION DETECTION
client.on("channelCreate", channel => {
  if (!channel.guild) return;

  checkAntiNuke(
    channel.guild,
    channel.id,
    AuditLogEvent.ChannelCreate,
    "channelCreate"
  );
});

// REGISTER SLASH COMMANDS
const rest = new REST({
  version: "10"
}).setToken(process.env.DISCORD_TOKEN);

async function registerCommands() {
  await rest.put(
    Routes.applicationCommands(
      process.env.CLIENT_ID
    ),
    {
      body: commands
    }
  );

  console.log("ZOMB commands registered!");
}

// BOT READY
client.once("ready", () => {
  console.log(
    `ZOMB online as ${client.user.tag}`
  );
});

// PREFIX COMMANDS
client.on("messageCreate", async message => {
  if (!message.guild || message.author.bot) return;

  const args = message.content.trim().split(/\s+/);
  const command = args[0].toLowerCase();

  if (
    command !== "~an" &&
    command !== "~antinuke"
  ) return;

  // OWNER ONLY
  if (message.author.id !== message.guild.ownerId) {
    return message.reply(
      "❌ Only the server owner can manage ZOMB's anti-nuke system."
    );
  }

  const action = (args[1] || "").toLowerCase();
  const guildId = message.guild.id;

  if (!Array.isArray(antiNukeData.trusted[guildId])) {
    antiNukeData.trusted[guildId] = [];
  }

  const trusted = antiNukeData.trusted[guildId];

  // TRUST MEMBER
  if (action === "trust") {
    const userId =
      message.mentions.users.first()?.id ||
      args[2]?.match(/^\d{17,20}$/)?.[0];

    if (!userId) {
      return message.reply(
        "Usage: `~an trust @user` or `~an trust USER_ID`"
      );
    }

    const trustedUser = await client.users
      .fetch(userId)
      .catch(() => null);

    if (
      !trustedUser ||
      trustedUser.bot ||
      userId === message.author.id
    ) {
      return message.reply(
        "❌ Invalid user. You cannot trust bots or yourself."
      );
    }

    if (trusted.includes(userId)) {
      return message.reply(
        "⚠️ This member is already trusted."
      );
    }

    trusted.push(userId);
    saveAntiNukeData();

    const embed = new EmbedBuilder()
      .setColor(0x8B0000)
      .setTitle("ZOMB | TRUST SYSTEM")
      .setDescription(
        `**${trustedUser.username}** you are now added to the trust team.`
      )
      .setFooter({
        text: "ZOMB ANTINUKE"
      })
      .setTimestamp();

    return message.reply({
      embeds: [embed]
    });
  }

  // UNTRUST MEMBER
  if (action === "untrust") {
    const userId =
      message.mentions.users.first()?.id ||
      args[2]?.match(/^\d{17,20}$/)?.[0];

    if (!userId) {
      return message.reply(
        "Usage: `~an untrust @user` or `~an untrust USER_ID`"
      );
    }

    const trustedUser = await client.users
      .fetch(userId)
      .catch(() => null);

    if (!trustedUser) {
      return message.reply(
        "❌ Could not find that Discord user."
      );
    }

    if (!trusted.includes(userId)) {
      return message.reply(
        "⚠️ This member is not on the trust team."
      );
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
      .setFooter({
        text: "ZOMB ANTINUKE"
      })
      .setTimestamp();

    return message.reply({
      embeds: [embed]
    });
  }

  // TRUST LIST
  if (action === "trustlist") {
    if (trusted.length === 0) {
      return message.reply(
        "The ZOMB trusted team is currently empty."
      );
    }

    const members = await Promise.all(
      trusted.map(id =>
        client.users.fetch(id).catch(() => null)
      )
    );

    const usernames = members
      .filter(Boolean)
      .map(user => `• ${user.username}`);

    const embed = new EmbedBuilder()
      .setColor(0x8B0000)
      .setTitle("ZOMB | TRUST TEAM")
      .setDescription(
        usernames.join("\n") ||
        "No available usernames found."
      )
      .setFooter({
        text: `ZOMB ANTINUKE • ${usernames.length} Trusted Members`
      })
      .setTimestamp();

    return message.reply({
      embeds: [embed]
    });
  }

  // ENABLE PROTECTION
  if (action === "enable") {
    antiNukeData.enabled[guildId] = true;
    saveAntiNukeData();

    return message.reply(
      "🛡️ **ZOMB Anti-Nuke Enabled**\nProtection is now active."
    );
  }

  // DISABLE PROTECTION
  if (action === "disable") {
    antiNukeData.enabled[guildId] = false;
    saveAntiNukeData();

    return message.reply(
      "⚠️ **ZOMB Anti-Nuke Disabled**\nProtection is now inactive."
    );
  }

  // CHECK STATUS
  if (action === "status") {
    const enabled =
      antiNukeData.enabled[guildId] === true;

    return message.reply(
      `🛡️ **Anti-Nuke:** ${enabled ? "ENABLED" : "DISABLED"}`
    );
  }

  // SET LOG CHANNEL
  if (action === "setlog") {
    const logChannel = await message.guild.channels
      .fetch(LOG_CHANNEL_ID)
      .catch(() => null);

    if (!logChannel || !logChannel.isTextBased()) {
      return message.reply(
        "❌ ZOMB could not find the log channel."
      );
    }

    antiNukeData.logs ||= {};
    antiNukeData.logs[guildId] = LOG_CHANNEL_ID;

    saveAntiNukeData();

    return message.reply(
      "🛡️ **ZOMB LOG SYSTEM**\nAnti-nuke logs connected successfully."
    );
  }

  // HELP MENU
  return message.reply(
    "**ZOMB ANTINUKE COMMANDS**\n\n" +
    "`~an trust @user` — Trust a member\n" +
    "`~an trust USER_ID` — Trust by ID\n" +
    "`~an untrust @user` — Remove a trusted member\n" +
    "`~an untrust USER_ID` — Remove by ID\n" +
    "`~an trustlist` — View trusted members\n" +
    "`~an enable` — Enable protection\n" +
    "`~an disable` — Disable protection\n" +
    "`~an status` — Check protection status\n" +
    "`~an setlog` — Configure the log channel"
  );
});

// START ZOMB
async function start() {
  await registerCommands();
  await client.login(process.env.DISCORD_TOKEN);
}

start().catch(error => {
  console.error("[ZOMB START ERROR]", error);
});
