
const fs = require("fs");
const path = require("path");

const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  AuditLogEvent,
  PermissionsBitField
} = require("discord.js");

// ==========================================
// ZOMB CONFIGURATION
// ==========================================

const DATA_FILE = process.env.ANTINUKE_FILE ||
  path.join(__dirname, "antinuke.json");

const LOG_CHANNEL_ID = "1575507474709090446";
const AUDIT_LOOKBACK_MS = 15000;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// ==========================================
// SLASH COMMANDS
// ==========================================

const commands = [
  new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Check ZOMB's response time"),

  new SlashCommandBuilder()
    .setName("help")
    .setDescription("View ZOMB commands")
].map(command => command.toJSON());

// ==========================================
// DATA STORAGE
// ==========================================

let antiNukeData = {
  trusted: {},
  enabled: {},
  logs: {},
  punishment: {}
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
        logs: saved.logs || {},
        punishment: saved.punishment || {}
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

// ==========================================
// ANTI-NUKE THRESHOLDS
// ==========================================

const ANTI_NUKE_LIMITS = {
  channelDelete: { max: 1, windowMs: 10000 },
  channelCreate: { max: 2, windowMs: 10000 },

  roleDelete: { max: 1, windowMs: 10000 },
  roleCreate: { max: 4, windowMs: 10000 },
  roleUpdate: { max: 2, windowMs: 10000 },

  channelPermissionChange: {
    max: 2,
    windowMs: 10000
  },

  memberKick: { max: 2, windowMs: 10000 },
  memberBan: { max: 2, windowMs: 10000 },
  botAdd: { max: 1, windowMs: 10000 },

  webhookCreate: { max: 2, windowMs: 10000 },
  webhookDelete: { max: 1, windowMs: 10000 },
  webhookUpdate: { max: 3, windowMs: 10000 },

  guildUpdate: { max: 2, windowMs: 10000 }
};

const actionTracker = new Map();
const processedAuditEntries = new Set();

// Dangerous permissions that should be monitored
const DANGEROUS_PERMISSIONS = [
  PermissionsBitField.Flags.Administrator,
  PermissionsBitField.Flags.ManageGuild,
  PermissionsBitField.Flags.ManageRoles,
  PermissionsBitField.Flags.ManageChannels,
  PermissionsBitField.Flags.BanMembers,
  PermissionsBitField.Flags.KickMembers,
  PermissionsBitField.Flags.ManageWebhooks,
  PermissionsBitField.Flags.ManageMessages,
  PermissionsBitField.Flags.MentionEveryone
];

function addedDangerousPermission(oldRole, newRole) {
  const oldBits = oldRole.permissions.bitfield;
  const newBits = newRole.permissions.bitfield;

  return DANGEROUS_PERMISSIONS.some(permission =>
    (newBits & permission) !== 0n &&
    (oldBits & permission) === 0n
  );
}

// ==========================================
// LOGGING
// ==========================================


async function sendAntiNukeLog(
  guild,
  title,
  description
) {
  try {
    const channelId =
      antiNukeData.logs?.[guild.id] ||
      LOG_CHANNEL_ID;

    const logChannel = await guild.channels
      .fetch(channelId)
      .catch(() => null);

    if (
      !logChannel ||
      !logChannel.isTextBased() ||
      !logChannel.send
    ) {
      console.error("[ZOMB] Log channel unavailable.");
      return false;
    }

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

    console.log("[ZOMB] Log message sent successfully.");
    return true;

  } catch (error) {
    console.error("[ZOMB LOG ERROR]", error);
    return false;
  }
}


// ==========================================
// ATTACKER PROTECTION
// ==========================================

async function punishAttacker(
  guild,
  executorId,
  executorName,
  actionName,
  threshold
) {
  let roleResponse = "Not attempted";
  let banResponse = "Not attempted";

  // Punishment requires separate authorization
  if (antiNukeData.punishment[guild.id] !== true) {
    await sendAntiNukeLog(
      guild,
      "SUSPICIOUS ACTIVITY DETECTED",
      `**Executor:** ${executorName}\n` +
      `**User ID:** ${executorId}\n` +
      `**Action:** ${actionName}\n` +
      `**Threshold:** ${threshold}\n\n` +
      "Automatic punishment is currently disabled."
    );

    return;
  }

  if (
    executorId === guild.ownerId ||
    executorId === client.user.id
  ) return;

  const trusted =
    antiNukeData.trusted[guild.id] || [];

  if (trusted.includes(executorId)) return;

  const member = await guild.members
    .fetch(executorId)
    .catch(() => null);

  if (!member || member.user.bot) return;

  const reason =
    `ZOMB Anti-Nuke: Excessive ${actionName} activity`;

  if (!member.bannable) {
    await sendAntiNukeLog(
      guild,
      "ATTACK DETECTED - ACTION BLOCKED",
      `**Executor:** ${executorName}\n` +
      `**Action:** ${actionName}\n` +
      "ZOMB cannot punish this member because of role hierarchy or permissions."
    );

    return;
  }

  // Remove manageable roles
  try {
    const removableRoles = member.roles.cache
      .filter(role =>
        role.id !== guild.id && role.editable
      )
      .map(role => role.id);

    if (removableRoles.length > 0) {
      await member.roles.remove(
        removableRoles,
        reason
      );

      roleResponse = "Manageable roles removed";
    } else {
      roleResponse = "No manageable roles";
    }
  } catch (error) {
    console.error("[ZOMB ROLE REMOVAL ERROR]", error);
    roleResponse = "Failed";
  }

  // Permanent ban
  try {
    await guild.members.ban(executorId, {
      reason
    });

    banResponse = "Permanent ban successful";

  } catch (error) {
    console.error("[ZOMB BAN ERROR]", error);
    banResponse = "Failed - check permissions";
  }

  await sendAntiNukeLog(
    guild,
    "ATTACK DETECTED",
    `**Attacker:** ${executorName}\n` +
    `**User ID:** ${executorId}\n` +
    `**Action:** ${actionName}\n` +
    `**Threshold:** ${threshold}\n` +
    `**Role Removal:** ${roleResponse}\n` +
    `**Ban Status:** ${banResponse}`
  );
}

// ==========================================
// AUDIT LOG PROCESSING
// ==========================================

async function processAuditEntries(
  guild,
  actionType,
  actionName,
  targetId = null
) {
  try {
    if (antiNukeData.enabled[guild.id] !== true) {
      return;
    }

   // Give Discord time to publish the audit-log entry
await new Promise(resolve => setTimeout(resolve, 1200));

const logs = await guild.fetchAuditLogs({
  type: actionType,
  limit: 20
});

    const now = Date.now();

    
const entries = [...logs.entries.values()]
  .filter(entry => {
    return Boolean(
      entry.executor &&
      now - entry.createdTimestamp >= 0 &&
      now - entry.createdTimestamp <= AUDIT_LOOKBACK_MS &&
      (
        !targetId ||
        entry.target?.id === targetId ||
        entry.extra?.channel?.id === targetId
      )
    );
  })
  .sort((a, b) =>
    a.createdTimestamp - b.createdTimestamp
  );


    for (const entry of entries) {
      const uniqueKey = `${guild.id}:${entry.id}`;

      if (processedAuditEntries.has(uniqueKey)) {
        continue;
      }

      // Mark before processing to prevent duplicate counting
      processedAuditEntries.add(uniqueKey);

      const executorId = entry.executor.id;

      if (
        executorId === guild.ownerId ||
        executorId === client.user.id ||
        entry.executor.bot
      ) {
        continue;
      }

      const trusted =
        antiNukeData.trusted[guild.id] || [];

      if (trusted.includes(executorId)) {
        continue;
      }

      const limit = ANTI_NUKE_LIMITS[actionName];

      if (!limit) continue;

      const key =
        `${guild.id}:${executorId}:${actionName}`;

      const timestamps = (
        actionTracker.get(key) || []
      ).filter(time =>
        now - time < limit.windowMs
      );

      timestamps.push(now);
      actionTracker.set(key, timestamps);

      if (timestamps.length < limit.max) {
        continue;
      }

      // Reset after threshold
      actionTracker.set(key, []);

      await punishAttacker(
        guild,
        executorId,
        entry.executor.username,
        actionName,
        `${limit.max} actions in 10 seconds`
      );
    }

    // Prevent unbounded memory growth
    if (processedAuditEntries.size > 5000) {
      processedAuditEntries.clear();
      actionTracker.clear();
    }

  } catch (error) {
    console.error(
      `[ZOMB AUDIT ERROR] ${actionName}`,
      error
    );
  }
}

// ==========================================
// CHANNEL PROTECTION
// ==========================================

client.on("channelDelete", channel => {
  if (!channel.guild) return;

  processAuditEntries(
    channel.guild,
    AuditLogEvent.ChannelDelete,
    "channelDelete",
    channel.id
  );
});

client.on("channelCreate", channel => {
  if (!channel.guild) return;

  processAuditEntries(
    channel.guild,
    AuditLogEvent.ChannelCreate,
    "channelCreate",
    channel.id
  );
});

function overwriteSnapshot(channel) {
  return [...channel.permissionOverwrites.cache.values()]
    .map(overwrite => ({
      id: overwrite.id,
      allow: overwrite.allow.bitfield.toString(),
      deny: overwrite.deny.bitfield.toString(),
      type: overwrite.type
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

client.on("channelUpdate", (oldChannel, newChannel) => {
  if (!newChannel.guild) return;

  const oldSnapshot = JSON.stringify(
    overwriteSnapshot(oldChannel)
  );

  const newSnapshot = JSON.stringify(
    overwriteSnapshot(newChannel)
  );

  if (oldSnapshot === newSnapshot) return;

  processAuditEntries(
    newChannel.guild,
    AuditLogEvent.ChannelOverwriteUpdate,
    "channelPermissionChange",
    newChannel.id
  );
});

// ==========================================
// ROLE PROTECTION
// ==========================================

client.on("roleDelete", role => {
  processAuditEntries(
    role.guild,
    AuditLogEvent.RoleDelete,
    "roleDelete",
    role.id
  );
});

client.on("roleCreate", role => {
  processAuditEntries(
    role.guild,
    AuditLogEvent.RoleCreate,
    "roleCreate",
    role.id
  );
});

client.on("roleUpdate", (oldRole, newRole) => {
  if (!addedDangerousPermission(oldRole, newRole)) {
    return;
  }

  processAuditEntries(
    newRole.guild,
    AuditLogEvent.RoleUpdate,
    "roleUpdate",
    newRole.id
  );
});

// ==========================================
// BAN AND KICK PROTECTION
// ==========================================

client.on("guildBanAdd", ban => {
  processAuditEntries(
    ban.guild,
    AuditLogEvent.MemberBanAdd,
    "memberBan",
    ban.user.id
  );
});

client.on("guildMemberRemove", member => {
  processAuditEntries(
    member.guild,
    AuditLogEvent.MemberKick,
    "memberKick",
    member.id
  );
});

// ==========================================
// BOT ADDITION PROTECTION
// ==========================================

client.on("guildMemberAdd", member => {
  if (!member.user.bot) return;

  processAuditEntries(
    member.guild,
    AuditLogEvent.BotAdd,
    "botAdd",
    member.id
  );
});

// ==========================================
// WEBHOOK PROTECTION
// ==========================================

client.on("webhooksUpdate", async channel => {
  if (!channel.guild) return;

  try {
    await new Promise(resolve => setTimeout(resolve, 1200));

    const webhookActions = [
      {
        type: AuditLogEvent.WebhookCreate,
        name: "webhookCreate"
      },
      {
        type: AuditLogEvent.WebhookDelete,
        name: "webhookDelete"
      },
      {
        type: AuditLogEvent.WebhookUpdate,
        name: "webhookUpdate"
      }
    ];

    for (const action of webhookActions) {
      await processAuditEntries(
        channel.guild,
        action.type,
        action.name
      );
    }
  } catch (error) {
    console.error("[ZOMB WEBHOOK ERROR]", error);
  }
});


// ==========================================
// SERVER SETTINGS PROTECTION
// ==========================================

client.on("guildUpdate", (oldGuild, newGuild) => {
  processAuditEntries(
    newGuild,
    AuditLogEvent.GuildUpdate,
    "guildUpdate",
    newGuild.id
  );
});

// ==========================================
// SLASH COMMAND REGISTRATION
// ==========================================

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

// ==========================================
// SLASH COMMAND HANDLER
// ==========================================

client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === "ping") {
    return interaction.reply({
      content: `🏓 ZOMB latency: ${client.ws.ping}ms`,
      ephemeral: true
    });
  }

  if (interaction.commandName === "help") {
    return interaction.reply({
      content:
        "**ZOMB COMMANDS**\n\n" +
        "`~an` — Anti-Nuke help\n" +
        "`~an status` — Protection status\n" +
        "`~an trust @user` — Trust a member\n" +
        "`~an untrust @user` — Remove trust\n" +
        "`~an trustlist` — View trusted members\n" +
        "`~an enable` — Enable detection\n" +
        "`~an disable` — Disable detection\n" +
        "`~an punishment enable` — Enable automatic punishment\n" +
        "`~an punishment disable` — Disable automatic punishment",
      ephemeral: true
    });
  }
});

// ==========================================
// PREFIX COMMAND HANDLER
// ==========================================

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

  // ========================================
  // TRUST MEMBER
  // ========================================

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
        `**${trustedUser.username}** is now on the trust team.`
      )
      .setFooter({ text: "ZOMB ANTINUKE" })
      .setTimestamp();

    return message.reply({ embeds: [embed] });
  }

  // ========================================
  // UNTRUST MEMBER
  // ========================================

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
        "⚠️ This member is not trusted."
      );
    }

    antiNukeData.trusted[guildId] =
      trusted.filter(id => id !== userId);

    saveAntiNukeData();

    const embed = new EmbedBuilder()
      .setColor(0x8B0000)
      .setTitle("ZOMB | TRUST SYSTEM")
      .setDescription(
        `**${trustedUser.username}** was removed from the trust team.`
      )
      .setFooter({ text: "ZOMB ANTINUKE" })
      .setTimestamp();

    return message.reply({ embeds: [embed] });
  }

  // ========================================
  // TRUST LIST
  // ========================================

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

    return message.reply({ embeds: [embed] });
  }

  // ========================================
  // ENABLE DETECTION
  // ========================================

  if (action === "enable") {
    antiNukeData.enabled[guildId] = true;
    saveAntiNukeData();

    return message.reply(
      "🛡️ **ZOMB Detection Enabled**\n" +
      "Security monitoring is now active.\n" +
      "Automatic punishment remains controlled separately."
    );
  }

  // ========================================
  // DISABLE DETECTION
  // ========================================

  if (action === "disable") {
    antiNukeData.enabled[guildId] = false;
    saveAntiNukeData();

    return message.reply(
      "⚠️ **ZOMB Detection Disabled**"
    );
  }

  // ========================================
  // AUTOMATIC PUNISHMENT CONTROL
  // ========================================

  if (action === "punishment") {
    const setting = (args[2] || "").toLowerCase();

    if (setting === "enable") {
      antiNukeData.punishment[guildId] = true;
      saveAntiNukeData();

      return message.reply(
        "⚠️ **Automatic punishment ENABLED.**\n" +
        "ZOMB may remove manageable roles and permanently ban detected attackers after a configured threshold."
      );
    }

    if (setting === "disable") {
      antiNukeData.punishment[guildId] = false;
      saveAntiNukeData();

      return message.reply(
        "🛡️ Automatic punishment disabled. Detection and logging can continue."
      );
    }

    return message.reply(
      "Usage: `~an punishment enable` or `~an punishment disable`"
    );
  }

  // ========================================
  // STATUS
  // ========================================

  if (action === "status") {
    const enabled =
      antiNukeData.enabled[guildId] === true;

    const punishment =
      antiNukeData.punishment[guildId] === true;

    return message.reply(
      `🛡️ **ZOMB ANTI-NUKE STATUS**\n\n` +
      `**Detection:** ${enabled ? "ENABLED" : "DISABLED"}\n` +
      `**Automatic Punishment:** ${punishment ? "ENABLED" : "DISABLED"}\n` +
      `**Trusted Members:** ${trusted.length}\n` +
      `**Logging:** ${antiNukeData.logs[guildId] ? "CONFIGURED" : "DEFAULT CHANNEL"}`
    );
  }

  // ========================================
  // SET LOG CHANNEL
  // ========================================

  
if (action === "setlog") {
  const selectedChannel =
    message.mentions.channels.first();

  const channelId =
    selectedChannel?.id || LOG_CHANNEL_ID;

  const logChannel = await message.guild.channels
    .fetch(channelId)
    .catch(() => null);

  if (
    !logChannel ||
    !logChannel.isTextBased() ||
    !logChannel.send
  ) {
    return message.reply(
      "❌ ZOMB cannot access that logging channel."
    );
  }

  antiNukeData.logs[guildId] = channelId;
  saveAntiNukeData();

  const sent = await sendAntiNukeLog(
    message.guild,
    "LOGGING TEST",
    "ZOMB successfully connected to this security log channel."
  );

  if (!sent) {
    return message.reply(
      "⚠️ Channel saved, but ZOMB could not send the test embed. Check its channel permissions."
    );
  }

  return message.reply(
    `🛡️ Logging configured and tested successfully in ${logChannel}.`
  );
}


  // ========================================
  // HELP MENU
  // ========================================

  return message.reply(
    "**ZOMB ANTINUKE COMMANDS**\n\n" +
    "`~an trust @user` — Trust a member\n" +
    "`~an trust USER_ID` — Trust by ID\n" +
    "`~an untrust @user` — Remove a trusted member\n" +
    "`~an untrust USER_ID` — Remove by ID\n" +
    "`~an trustlist` — View trusted members\n" +
    "`~an enable` — Enable detection\n" +
    "`~an disable` — Disable detection\n" +
    "`~an punishment enable` — Enable automatic punishment\n" +
    "`~an punishment disable` — Disable automatic punishment\n" +
    "`~an status` — Check system status\n" +
    "`~an setlog` — Configure logging\n" +
    "`~an setlog #channel` — Select a log channel"
  );
});

// ==========================================
// BOT READY
// ==========================================

client.once("clientReady", () => {
  console.log(
    `ZOMB online as ${client.user.tag}`
  );
});

// ==========================================
// START ZOMB
// ==========================================

async function start() {
  await registerCommands();
  await client.login(process.env.DISCORD_TOKEN);
}

start().catch(error => {
  console.error("[ZOMB START ERROR]", error);
});
