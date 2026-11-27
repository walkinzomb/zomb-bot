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
  PermissionsBitField,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder
} = require("discord.js");

// ==========================================
// ZOMB CONFIGURATION
// ==========================================

const DATA_FILE = process.env.ANTINUKE_FILE ||
  path.join("/data", "antinuke.json");

const LOG_CHANNEL_ID = "1575507474709090446";
const AUDIT_LOOKBACK_MS = 15000;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.MessageContent
  ]
});

// ==========================================
// PROFESSIONAL EMBEDS
// ==========================================

function zombEmbed(title, description, color = 0x2B2D31) {
  return new EmbedBuilder()
    .setColor(color)
    .setTitle(`ZOMB | ${title}`)
    .setDescription(String(description).slice(0, 4000))
    .setFooter({ text: "ZOMB SECURITY" })
    .setTimestamp();
}

function zombPayload(payload, title = "SYSTEM MESSAGE") {
  if (typeof payload === "string") {
    return {
      embeds: [zombEmbed(title, payload)]
    };
  }

  if (!payload || typeof payload !== "object") {
    return payload;
  }

  if (payload.embeds?.length) {
    return payload;
  }

  if (payload.content) {
    const { content, ...rest } = payload;

    return {
      ...rest,
      embeds: [zombEmbed(title, content)]
    };
  }

  return payload;
}

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
  punishment: {},
  antiBot: {},
  vouches: {},
  vouchRoles: {},
  jailRoles: {},
  jailChannels: {}
  
};

function loadAntiNukeData() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      return {
        trusted: {},
        enabled: {},
        logs: {},
        punishment: {},
        antiBot: {},
        vouches: {},
        vouchRoles: {},
        jailRoles: {},
        jailChannels: {}
      };
    }

    const saved = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));

    return {
      trusted: saved.trusted || {},
      enabled: saved.enabled || {},
      logs: saved.logs || {},
      punishment: saved.punishment || {},
      antiBot: saved.antiBot || {},
      vouches: saved.vouches || {},
      vouchRoles: saved.vouchRoles || {},
      jailRoles: saved.jailRoles || {},
      jailChannels: saved.jailChannels || {}
    };

  } catch (error) {
    console.error("[ZOMB] Failed to load anti-nuke data:", error);

    return {
      trusted: {},
      enabled: {},
      logs: {},
      punishment: {},
      antiBot: {},
      vouches: {},
      vouchRoles: {},
      jailRoles: {},
      jailChannels: {}
    };
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

    return true;
  } catch (error) {
    console.error("[ZOMB SAVE ERROR]", error);
    return false;
  }
}

loadAntiNukeData();

// ==========================================
// VOUCH SYSTEM
// ==========================================

const VOUCH_LIMITS = {
  staff: 3,
  admin: 2
};

const STAFF_EXTRA_PERMISSIONS = [
  PermissionsBitField.Flags.ManageGuild,
  PermissionsBitField.Flags.ManageChannels,
  PermissionsBitField.Flags.KickMembers,
  PermissionsBitField.Flags.BanMembers,
  PermissionsBitField.Flags.ManageMessages,
  PermissionsBitField.Flags.ModerateMembers,
  PermissionsBitField.Flags.ManageWebhooks,
  PermissionsBitField.Flags.ManageNicknames,
  PermissionsBitField.Flags.ViewAuditLog
];

function getVoucherData(guildId, voucherId) {
  antiNukeData.vouches[guildId] ??= {};
  antiNukeData.vouches[guildId][voucherId] ??= {
    staff: [],
    admin: []
  };

  const data = antiNukeData.vouches[guildId][voucherId];

  if (!Array.isArray(data.staff)) data.staff = [];
  if (!Array.isArray(data.admin)) data.admin = [];

  return data;
}

function getSavedVouchRoles(guildId, voucherId, type) {
  antiNukeData.vouchRoles[guildId] ??= {};
  antiNukeData.vouchRoles[guildId][voucherId] ??= {
    staff: {},
    admin: {}
  };
  antiNukeData.vouchRoles[guildId][voucherId][type] ??= {};

  return antiNukeData.vouchRoles[guildId][voucherId][type];
}

function isTrusted(guildId, userId, ownerId) {
  return userId === ownerId ||
    (antiNukeData.trusted[guildId] || []).includes(userId);
}

// ==========================================
// ANTI-NUKE THRESHOLDS
// ==========================================

const ANTI_NUKE_LIMITS = {
  channelDelete: { max: 1, windowMs: 10000 },
  channelCreate: { max: 2, windowMs: 10000 },
  roleDelete: { max: 1, windowMs: 10000 },
  roleCreate: { max: 4, windowMs: 10000 },
  roleUpdate: { max: 2, windowMs: 10000 },
  channelPermissionChange: { max: 2, windowMs: 10000 },
  memberKick: { max: 2, windowMs: 10000 },
  memberBan: { max: 1, windowMs: 10000 },
  botAdd: { max: 1, windowMs: 10000 },
  webhookCreate: { max: 2, windowMs: 10000 },
  webhookDelete: { max: 1, windowMs: 10000 },
  webhookUpdate: { max: 3, windowMs: 10000 },
  guildUpdate: { max: 1, windowMs: 10000 }
};

const actionTracker = new Map();
const processedAuditEntries = new Set();

// ==========================================
// ANTI-SPAM SETTINGS
// ==========================================

const spamTracker = new Map();
const spamAlertCooldown = new Map();

const SPAM_LIMIT = 5;
const SPAM_WINDOW_MS = 5000;
const SPAM_COOLDOWN_MS = 30000;

// ==========================================
// ANTI-LINK SETTINGS
// ==========================================

const linkTracker = new Map();
const linkAlertCooldown = new Map();

const LINK_LIMIT = 1;
const LINK_WINDOW_MS = 10000;
const LINK_COOLDOWN_MS = 30000;

// ==========================================
// ANTI-RAID SETTINGS
// ==========================================

const raidTracker = new Map();
const raidAlertCooldown = new Map();

const RAID_LIMIT = 5;
const RAID_WINDOW_MS = 10000;
const RAID_COOLDOWN_MS = 60000;

// ==========================================
// DANGEROUS PERMISSIONS
// ==========================================

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

async function sendAntiNukeLog(guild, title, description) {
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

    await logChannel.send({
      embeds: [
        zombEmbed(title, description, 0x8B0000)
          .setFooter({ text: "ZOMB ANTINUKE SECURITY" })
      ]
    });

    return true;
  } catch (error) {
    console.error("[ZOMB LOG ERROR]", error);
    return false;
  }
}

// ==========================================
// ANTI-SPAM DETECTION
// ==========================================

async function checkAntiSpam(message) {
  if (!message.guild || message.author.bot) return;

  const guildId = message.guild.id;
  const userId = message.author.id;

  if (antiNukeData.enabled[guildId] !== true) return;
  if (userId === message.guild.ownerId) return;

  const trustedList = antiNukeData.trusted[guildId] || [];
  if (trustedList.includes(userId)) return;

  const key = `${guildId}:${userId}`;
  const now = Date.now();

  const timestamps = (spamTracker.get(key) || [])
    .filter(time => now - time < SPAM_WINDOW_MS);

  timestamps.push(now);
  spamTracker.set(key, timestamps);

  if (timestamps.length < SPAM_LIMIT) return;

  const lastAlert = spamAlertCooldown.get(key) || 0;
  if (now - lastAlert < SPAM_COOLDOWN_MS) return;

  spamAlertCooldown.set(key, now);

  await sendAntiNukeLog(
    message.guild,
    "ANTI-SPAM ALERT",
    `**Member:** ${message.author.tag}\n` +
    `**User ID:** ${userId}\n` +
    `**Messages:** ${timestamps.length} in 5 seconds\n` +
    "**Action:** Spam detected. No automatic punishment."
  );
}

// ==========================================
// ANTI-LINK DETECTION
// ==========================================

async function checkAntiLink(message) {
  if (!message.guild || message.author.bot) return;

  const guildId = message.guild.id;
  const userId = message.author.id;

  if (antiNukeData.enabled[guildId] !== true) return;
  if (userId === message.guild.ownerId) return;

  const trusted = antiNukeData.trusted[guildId] || [];
  if (trusted.includes(userId)) return;

  const inviteRegex =
    /(?:https?:\/\/)?(?:www\.)?(?:discord\.gg|discord(?:app)?\.com\/invite)\/[A-Za-z0-9-]+/gi;

  if (inviteRegex.test(message.content)) return;

  const linkRegex = /https?:\/\/\S+|www\.\S+/gi;
  const links = message.content.match(linkRegex);

  if (!links) return;

  const key = `${guildId}:${userId}`;
  const now = Date.now();

  const timestamps = (linkTracker.get(key) || [])
    .filter(time => now - time < LINK_WINDOW_MS);

  timestamps.push(now);
  linkTracker.set(key, timestamps);

  if (timestamps.length < LINK_LIMIT) return;

  const lastAlert = linkAlertCooldown.get(key) || 0;
  if (now - lastAlert < LINK_COOLDOWN_MS) return;

  linkAlertCooldown.set(key, now);

  const detectedLinks = links
    .slice(0, 5)
    .join(", ")
    .slice(0, 900);

  await sendAntiNukeLog(
    message.guild,
    "ANTI-LINK ALERT",
    `**Member:** ${message.author.tag}\n` +
    `**User ID:** ${userId}\n` +
    `**Link posted:** ${detectedLinks}\n` +
    "**Action:** Link detected. No automatic deletion or punishment."
  );
}

// ==========================================
// ANTI-INVITE DETECTION
// ==========================================

async function checkAntiInvite(message) {
  if (!message.guild || message.author.bot) return;

  const guildId = message.guild.id;
  const userId = message.author.id;

  if (antiNukeData.enabled[guildId] !== true) return;
  if (userId === message.guild.ownerId) return;

  const trusted = antiNukeData.trusted[guildId] || [];
  if (trusted.includes(userId)) return;

  const inviteRegex =
    /(?:https?:\/\/)?(?:www\.)?(?:discord\.gg|discord(?:app)?\.com\/invite)\/[A-Za-z0-9-]+/gi;

  const invites = message.content.match(inviteRegex);
  if (!invites) return;

  let deleteStatus = "Failed - check Manage Messages permission";

  try {
    await message.delete();
    deleteStatus = "Successfully deleted";
  } catch (error) {
    console.error("[ZOMB ANTI-INVITE DELETE ERROR]", error);
  }

  await sendAntiNukeLog(
    message.guild,
    "ANTI-INVITE DETECTED",
    `**Member:** ${message.author.tag}\n` +
    `**User ID:** ${userId}\n` +
    `**Invite posted:** ${invites.join(", ").slice(0, 900)}\n` +
    `**Message deletion:** ${deleteStatus}`
  );
}

// ==========================================
// ANTI-RAID DETECTION
// ==========================================

async function checkAntiRaid(member) {
  if (!member.guild) return;

  const guild = member.guild;
  const guildId = guild.id;

  if (antiNukeData.enabled[guildId] !== true) return;

  const now = Date.now();

  const timestamps = (raidTracker.get(guildId) || [])
    .filter(time => now - time < RAID_WINDOW_MS);

  timestamps.push(now);
  raidTracker.set(guildId, timestamps);

  if (timestamps.length < RAID_LIMIT) return;

  const lastAlert = raidAlertCooldown.get(guildId) || 0;
  if (now - lastAlert < RAID_COOLDOWN_MS) return;

  raidAlertCooldown.set(guildId, now);

  await sendAntiNukeLog(
    guild,
    "ANTI-RAID ALERT",
    `**Server:** ${guild.name}\n` +
    `**Recent joins:** ${timestamps.length} in 10 seconds\n` +
    `**Latest member:** ${member.user.tag}\n` +
    `**User ID:** ${member.id}\n` +
    "**Action:** Possible join raid detected. No automatic kick or ban."
  );
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

  const trusted = antiNukeData.trusted[guild.id] || [];
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

  try {
    const removableRoles = member.roles.cache
      .filter(role =>
        role.id !== guild.id && role.editable
      )
      .map(role => role.id);

    if (removableRoles.length > 0) {
      await member.roles.remove(removableRoles, reason);
      roleResponse = "Manageable roles removed";
    } else {
      roleResponse = "No manageable roles";
    }
  } catch (error) {
    console.error("[ZOMB ROLE REMOVAL ERROR]", error);
    roleResponse = "Failed";
  }

  try {
    await guild.members.ban(executorId, { reason });
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
    if (antiNukeData.enabled[guild.id] !== true) return;

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

      if (processedAuditEntries.has(uniqueKey)) continue;

      processedAuditEntries.add(uniqueKey);

      const executorId = entry.executor.id;

      if (
        executorId === guild.ownerId ||
        executorId === client.user.id ||
        entry.executor.bot
      ) continue;

      const trusted = antiNukeData.trusted[guild.id] || [];
      if (trusted.includes(executorId)) continue;

      const limit = ANTI_NUKE_LIMITS[actionName];
      if (!limit) continue;

      const key =
        `${guild.id}:${executorId}:${actionName}`;

      const timestamps = (actionTracker.get(key) || [])
        .filter(time => now - time < limit.windowMs);

      timestamps.push(now);
      actionTracker.set(key, timestamps);

      if (timestamps.length < limit.max) continue;

      actionTracker.set(key, []);

      await punishAttacker(
        guild,
        executorId,
        entry.executor.username,
        actionName,
        `${limit.max} actions in 10 seconds`
      );
    }

    if (processedAuditEntries.size > 5000) {
      processedAuditEntries.clear();
      actionTracker.clear();
    }
  } catch (error) {
    console.error(`[ZOMB AUDIT ERROR] ${actionName}`, error);
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

  const oldSnapshot = JSON.stringify(overwriteSnapshot(oldChannel));
  const newSnapshot = JSON.stringify(overwriteSnapshot(newChannel));

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
  if (!addedDangerousPermission(oldRole, newRole)) return;

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
// ANTI-BOT PROTECTION
// ==========================================

async function checkAntiBot(member) {
  if (!member.guild || !member.user.bot) return;

  const guild = member.guild;
  const guildId = guild.id;

  if (antiNukeData.antiBot[guildId] !== true) return;

  await new Promise(resolve => setTimeout(resolve, 1500));

  try {
    const logs = await guild.fetchAuditLogs({
      type: AuditLogEvent.BotAdd,
      limit: 10
    });

    const entry = [...logs.entries.values()]
      .filter(entry =>
        entry.target?.id === member.id &&
        entry.executor &&
        Date.now() - entry.createdTimestamp <= 15000
      )
      .sort((a, b) =>
        b.createdTimestamp - a.createdTimestamp
      )[0];

    if (!entry) {
      await sendAntiNukeLog(
        guild,
        "ANTI-BOT WARNING",
        `**Bot:** ${member.user.tag}\n` +
        `**Bot ID:** ${member.id}\n` +
        "**Action:** Inviter could not be verified. No kick performed."
      );
      return;
    }

    const executorId = entry.executor.id;
    const trusted = antiNukeData.trusted[guildId] || [];

    if (
      executorId === guild.ownerId ||
      trusted.includes(executorId)
    ) {
      await sendAntiNukeLog(
        guild,
        "AUTHORIZED BOT",
        `**Bot:** ${member.user.tag}\n` +
        `**Added by:** ${entry.executor.username}\n` +
        "**Action:** Allowed to stay."
      );
      return;
    }

    let kickStatus = "Failed";

    try {
      if (member.kickable) {
        await member.kick(
          "ZOMB Anti-Bot: Unauthorized bot"
        );
        kickStatus = "Successfully kicked";
      } else {
        kickStatus = "Cannot kick - check permissions";
      }
    } catch (error) {
      console.error("[ZOMB ANTI-BOT KICK ERROR]", error);
    }

    await sendAntiNukeLog(
      guild,
      "UNAUTHORIZED BOT DETECTED",
      `**Bot:** ${member.user.tag}\n` +
      `**Bot ID:** ${member.id}\n` +
      `**Added by:** ${entry.executor.username}\n` +
      `**Action:** ${kickStatus}`
    );
  } catch (error) {
    console.error("[ZOMB ANTI-BOT ERROR]", error);
  }
}

// ==========================================
// MEMBER JOIN / BOT ADDITION / ANTI-RAID
// ==========================================

client.on("guildMemberAdd", member => {
  checkAntiRaid(member).catch(error => {
    console.error("[ZOMB ANTI-RAID ERROR]", error);
  });

  if (!member.user.bot) return;

  checkAntiBot(member).catch(error => {
    console.error("[ZOMB ANTI-BOT ERROR]", error);
  });

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

client.on("guildUpdate", async (oldGuild, newGuild) => {
  const changes = [];

  if (oldGuild.name !== newGuild.name) {
    changes.push("Server name changed");
  }

  if (oldGuild.icon !== newGuild.icon) {
    changes.push("Server icon changed");
  }

  if (oldGuild.banner !== newGuild.banner) {
    changes.push("Server banner changed");
  }

  if (oldGuild.vanityURLCode !== newGuild.vanityURLCode) {
    changes.push("Server vanity URL changed");
  }

  if (changes.length === 0) return;

  await processAuditEntries(
    newGuild,
    AuditLogEvent.GuildUpdate,
    "guildUpdate",
    newGuild.id
  );
});
// ==========================================
// ZOMB MODERATION AND TIC TAC TOE HELPERS
// ==========================================

const ticTacToeGames = new Map();

function parseDuration(value) {
  const match = String(value || "").match(/^(\d+)(s|m|h|d)$/i);
  if (!match) return null;

  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();

  const multipliers = {
    s: 1000,
    m: 60000,
    h: 3600000,
    d: 86400000
  };

  const duration = amount * multipliers[unit];

  if (
    !Number.isFinite(duration) ||
    duration < 1000 ||
    duration > 28 * 86400000
  ) {
    return null;
  }

  return duration;
}

function getTicTacToeWinner(board) {
  const wins = [
    [0, 1, 2],
    [3, 4, 5],
    [6, 7, 8],
    [0, 3, 6],
    [1, 4, 7],
    [2, 5, 8],
    [0, 4, 8],
    [2, 4, 6]
  ];

  for (const [a, b, c] of wins) {
    if (
      board[a] &&
      board[a] === board[b] &&
      board[a] === board[c]
    ) {
      return board[a];
    }
  }

  return null;
}


function buildTicTacToeRows(gameId, game) {
  const rows = [];

  for (let row = 0; row < 3; row++) {
    const buttons = [];

    for (let column = 0; column < 3; column++) {
      const index = row * 3 + column;
      const mark = game.board[index];

      buttons.push(
        new ButtonBuilder()
          .setCustomId(`zomb_ttt|${gameId}|${index}`)
          .setLabel(mark || "_")
          .setStyle(
            mark === "X"
              ? ButtonStyle.Primary
              : mark === "O"
                ? ButtonStyle.Danger
                : ButtonStyle.Secondary
          )
          .setDisabled(Boolean(mark) || game.finished)
      );
    }

    rows.push(
      new ActionRowBuilder().addComponents(buttons)
    );
  }

  return rows;
}

// ==========================================
// SLASH COMMAND REGISTRATION
// ==========================================

const rest = new REST({ version: "10" })
  .setToken(process.env.DISCORD_TOKEN);

async function registerCommands() {
  if (!process.env.CLIENT_ID) {
    throw new Error("CLIENT_ID environment variable is missing.");
  }

  await rest.put(
    Routes.applicationCommands(process.env.CLIENT_ID),
    { body: commands }
  );

  console.log("[ZOMB] Slash commands registered.");
}

// ==========================================
// INTERACTION HANDLER
// ==========================================

client.on("interactionCreate", async interaction => {
  try {
    // Automatically convert plain-text interaction responses into embeds.
    const originalReply = interaction.reply.bind(interaction);
    interaction.reply = payload =>
      originalReply(zombPayload(payload));

    const originalUpdate = interaction.update.bind(interaction);
    interaction.update = payload =>
      originalUpdate(zombPayload(payload));

    const originalEditReply = interaction.editReply.bind(interaction);
    interaction.editReply = payload =>
      originalEditReply(zombPayload(payload));
// ==========================================
// TIC TAC TOE BUTTONS
// ==========================================

if (
  interaction.isButton() &&
  interaction.customId.startsWith("zomb_ttt|")
) {
  const [, gameId, indexText] = interaction.customId.split("|");
  const index = Number(indexText);
  const game = ticTacToeGames.get(gameId);

  if (!game) {
    return interaction.reply({
      content: "This game has expired.",
      ephemeral: true
    });
  }

  if (
    interaction.user.id !== game.players.X &&
    interaction.user.id !== game.players.O
  ) {
    return interaction.reply({
      content: "You are not a player in this game.",
      ephemeral: true
    });
  }

  if (game.finished) {
    return interaction.reply({
      content: "This game has already ended.",
      ephemeral: true
    });
  }

  if (interaction.user.id !== game.players[game.turn]) {
    return interaction.reply({
      content: "It is not your turn.",
      ephemeral: true
    });
  }

  if (
    !Number.isInteger(index) ||
    index < 0 ||
    index > 8 ||
    game.board[index]
  ) {
    return interaction.reply({
      content: "That square is unavailable.",
      ephemeral: true
    });
  }

  game.board[index] = game.turn;

  const winner = getTicTacToeWinner(game.board);
  let result;

  if (winner) {
    game.finished = true;
    result = `🏆 <@${game.players[winner]}> wins!`;
  } else if (game.board.every(Boolean)) {
    game.finished = true;
    result = "It's a tie!";
  } else {
    game.turn = game.turn === "X" ? "O" : "X";
    result = `**Turn:** <@${game.players[game.turn]}> (${game.turn})`;
  }

  await interaction.update({
    content:
      `**ZOMB TIC TAC TOE**\n\n` +
      `❌ X: <@${game.players.X}>\n` +
      `⭕ O: <@${game.players.O}>\n\n` +
      result,
    components: buildTicTacToeRows(gameId, game)
  });

  if (game.finished) {
    ticTacToeGames.delete(gameId);
  }

  return;
}
    // ==========================================
    // VOUCH TYPE BUTTONS
    // ==========================================

    if (
      interaction.isButton() &&
      interaction.customId.startsWith("zomb_vouch_type|")
    ) {
      const parts = interaction.customId.split("|");
      const [, guildId, voucherId, targetId, type] = parts;

      if (
        interaction.user.id !== voucherId ||
        interaction.guildId !== guildId
      ) {
        return interaction.reply({
          content: "This vouch menu belongs to someone else.",
          ephemeral: true
        });
      }

      if (!["staff", "admin"].includes(type)) {
        return interaction.reply({
          content: "Invalid vouch type.",
          ephemeral: true
        });
      }

      if (!isTrusted(guildId, voucherId, interaction.guild.ownerId)) {
        return interaction.reply({
          content: "You are no longer trusted to use the vouch system.",
          ephemeral: true
        });
      }

      const voucherData = getVoucherData(guildId, voucherId);
      const limit = VOUCH_LIMITS[type];

      if (
        voucherData[type].includes(targetId) ||
        voucherData[type].length >= limit
      ) {
        return interaction.reply({
          content: "This vouch was already used or your limit has been reached.",
          ephemeral: true
        });
      }

      const roleMenu = new RoleSelectMenuBuilder()
        .setCustomId(
          `zomb_vouch_role|${guildId}|${voucherId}|${targetId}|${type}`
        )
        .setPlaceholder(`Choose the ${type} role to assign`)
        .setMinValues(1)
        .setMaxValues(1);

      return interaction.update({
  embeds: [
    zombEmbed(
      `${type.toUpperCase()} VOUCH`,
      `Select the exact role you want to give <@${targetId}>.`,
      type === "staff" ? 0x57F287 : 0xED4245
    )
  ],
  content: null,
  components: [
    new ActionRowBuilder().addComponents(roleMenu)
  ]
});
    }

    // ==========================================
    // VOUCH ROLE PICKER
    // ==========================================

    if (
      interaction.isRoleSelectMenu() &&
      interaction.customId.startsWith("zomb_vouch_role|")
    ) {
      const parts = interaction.customId.split("|");
      const [, guildId, voucherId, targetId, type] = parts;

      if (
        interaction.user.id !== voucherId ||
        interaction.guildId !== guildId
      ) {
        return interaction.reply({
          content: "This role picker belongs to someone else.",
          ephemeral: true
        });
      }

      if (!["staff", "admin"].includes(type)) {
        return interaction.reply({
          content: "Invalid vouch type.",
          ephemeral: true
        });
      }

      if (!isTrusted(guildId, voucherId, interaction.guild.ownerId)) {
        return interaction.reply({
          content: "You are no longer trusted to use the vouch system.",
          ephemeral: true
        });
      }

      await interaction.deferUpdate();

      const guild = interaction.guild;
      const selectedRoleId = interaction.values[0];

      const [voucherMember, targetMember, botMember, role] =
        await Promise.all([
          guild.members.fetch({
            user: voucherId,
            force: true
          }).catch(() => null),

          guild.members.fetch({
            user: targetId,
            force: true
          }).catch(() => null),

          guild.members.fetchMe().catch(() => null),

          guild.roles.fetch(selectedRoleId).catch(() => null)
        ]);

      if (!voucherMember || !targetMember || !botMember || !role) {
        return interaction.editReply({
          content: "ZOMB could not find the selected member or role.",
          components: []
        });
      }

      const voucherData = getVoucherData(guildId, voucherId);
      const limit = VOUCH_LIMITS[type];

      if (
        voucherData[type].includes(targetId) ||
        voucherData[type].length >= limit
      ) {
        return interaction.editReply({
          content: "This vouch was already used or your limit has been reached.",
          components: []
        });
      }

      if (
        targetId === voucherId ||
        targetId === guild.ownerId ||
        targetMember.user.bot
      ) {
        return interaction.editReply({
          content: "You cannot vouch for this member.",
          components: []
        });
      }

      if (
        role.id === guild.id ||
        role.managed
      ) {
        return interaction.editReply({
          content: "That role cannot be assigned by the vouch system.",
          components: []
        });
      }

      const isAdminRole = role.permissions.has(
        PermissionsBitField.Flags.Administrator
      );

      const isStaffRole =
        !isAdminRole &&
        role.permissions.has(
          PermissionsBitField.Flags.ManageRoles
        ) &&
        STAFF_EXTRA_PERMISSIONS.some(permission =>
          role.permissions.has(permission)
        );

      if (type === "admin" && !isAdminRole) {
        return interaction.editReply({
          content: "The selected role does not have Administrator permission.",
          components: []
        });
      }

      if (type === "staff" && !isStaffRole) {
        return interaction.editReply({
          content: "The selected role does not qualify as a Staff role.",
          components: []
        });
      }

      if (
        !botMember.permissions.has(
          PermissionsBitField.Flags.ManageRoles
        ) ||
        role.position >= voucherMember.roles.highest.position ||
        role.position >= botMember.roles.highest.position ||
        !role.editable
      ) {
        return interaction.editReply({
          content:
            "That role is too high for you or ZOMB to assign, or ZOMB lacks Manage Roles.",
          components: []
        });
      }

      if (targetMember.roles.cache.has(role.id)) {
        return interaction.editReply({
          content: "That member already has this role. No vouch was used.",
          components: []
        });
      }

      const savedRoles = getSavedVouchRoles(
        guildId,
        voucherId,
        type
      );

      try {
        await targetMember.roles.add(
          role.id,
          `ZOMB ${type} vouch by ${interaction.user.tag}`
        );

        const verifiedMember = await guild.members.fetch({
          user: targetId,
          force: true
        });

        if (!verifiedMember.roles.cache.has(role.id)) {
          throw new Error("Discord did not confirm the role assignment.");
        }

        // Record the vouch only after Discord confirms the role.
        voucherData[type].push(targetId);
        savedRoles[targetId] = role.id;

        if (!saveAntiNukeData()) {
          voucherData[type] = voucherData[type].filter(
            id => id !== targetId
          );

          delete savedRoles[targetId];

          await targetMember.roles.remove(
            role.id,
            "ZOMB vouch rollback: data could not be saved"
          ).catch(error => {
            console.error("[ZOMB VOUCH ROLLBACK ERROR]", error);
          });

          throw new Error("ZOMB could not save the vouch data.");
        }

        const used = voucherData[type].length;
        const remaining = limit - used;

        return interaction.editReply({
          content:
            `**VOUCH SUCCESSFUL**\n\n` +
            `**Voucher:** <@${voucherId}>\n` +
            `**Member:** <@${targetId}>\n` +
            `**Position:** ${type.toUpperCase()}\n` +
            `**Role assigned:** <@&${role.id}>\n` +
            `**Vouches used:** ${used}/${limit}\n` +
            `**Vouches remaining:** ${remaining}`,
          components: []
        });
      } catch (error) {
        console.error("[ZOMB VOUCH ERROR]", error);

        return interaction.editReply({
          content:
            "ZOMB could not complete and save the role assignment. Your vouch was not recorded.",
          components: []
        });
      }
    }

    // ==========================================
    // STRIPSTAFF SELECT MENU
    // ==========================================

    if (
      interaction.isStringSelectMenu() &&
      interaction.customId.startsWith("zomb_strip|")
    ) {
      const parts = interaction.customId.split("|");
      const [, guildId, voucherId] = parts;

      if (
        interaction.user.id !== voucherId ||
        interaction.guildId !== guildId
      ) {
        return interaction.reply({
          content: "This menu belongs to someone else.",
          ephemeral: true
        });
      }

      if (!isTrusted(guildId, voucherId, interaction.guild.ownerId)) {
        return interaction.reply({
          content: "You are no longer trusted to use this menu.",
          ephemeral: true
        });
      }

      const [type, targetId] = interaction.values[0].split(":");

      if (!["staff", "admin"].includes(type)) {
        return interaction.update({
          content: "Invalid vouch selection.",
          components: []
        });
      }

      const voucherData = getVoucherData(guildId, voucherId);

      if (!voucherData[type].includes(targetId)) {
        return interaction.update({
          content: "That vouch could not be found.",
          components: []
        });
      }

      const targetMember = await interaction.guild.members
        .fetch(targetId)
        .catch(() => null);

      if (!targetMember) {
        return interaction.update({
          content: "That member could not be found.",
          components: []
        });
      }

      const savedRoles = getSavedVouchRoles(
        guildId,
        voucherId,
        type
      );

      const roleId = savedRoles[targetId];

      const role = roleId
        ? await interaction.guild.roles.fetch(roleId).catch(() => null)
        : null;

      // Older vouches may not have saved role information.
      if (!role) {
        const roleMenu = new RoleSelectMenuBuilder()
          .setCustomId(
            `zomb_strip_role|${guildId}|${voucherId}|${type}|${targetId}`
          )
          .setPlaceholder("Select the role originally given")
          .setMinValues(1)
          .setMaxValues(1);

        return interaction.update({
          content:
            `**OLDER VOUCH FOUND**\n\n` +
            `**Member:** <@${targetId}>\n` +
            `**Position:** ${type.toUpperCase()}\n\n` +
            "ZOMB does not have the saved role information. Select the role originally given. ZOMB will verify the member has it before removing it.",
          components: [
            new ActionRowBuilder().addComponents(roleMenu)
          ]
        });
      }

      if (targetMember.roles.cache.has(role.id)) {
        try {
          await targetMember.roles.remove(
            role.id,
            `ZOMB vouch removed by ${interaction.user.tag}`
          );
        } catch (error) {
          console.error("[ZOMB STRIPSTAFF ERROR]", error);

          return interaction.update({
            content: "ZOMB could not remove that role. Check its permissions and hierarchy.",
            components: []
          });
        }
      }

      const oldVouches = [...voucherData[type]];
      const oldRoleId = savedRoles[targetId];

      voucherData[type] = voucherData[type].filter(
        id => id !== targetId
      );

      delete savedRoles[targetId];

      if (!saveAntiNukeData()) {
        voucherData[type] = oldVouches;
        savedRoles[targetId] = oldRoleId;

        return interaction.update({
          content: "The role was removed, but ZOMB could not save the vouch change. Please contact the server owner.",
          components: []
        });
      }

      return interaction.update({
        content:
          `**VOUCH REMOVED**\n\n` +
          `**Member:** <@${targetId}>\n` +
          `**Position:** ${type.toUpperCase()}\n` +
          `**Role removed:** <@&${role.id}>\n` +
          "Your vouch slot has been restored.",
        components: []
      });
    }

    // ==========================================
    // OLDER VOUCH ROLE SELECTION
    // ==========================================

    if (
      interaction.isRoleSelectMenu() &&
      interaction.customId.startsWith("zomb_strip_role|")
    ) {
      const parts = interaction.customId.split("|");
      const [, guildId, voucherId, type, targetId] = parts;

      if (
        interaction.user.id !== voucherId ||
        interaction.guildId !== guildId
      ) {
        return interaction.reply({
          content: "This menu belongs to someone else.",
          ephemeral: true
        });
      }

      if (!isTrusted(guildId, voucherId, interaction.guild.ownerId)) {
        return interaction.reply({
          content: "You are no longer trusted to use this menu.",
          ephemeral: true
        });
      }

      if (!["staff", "admin"].includes(type)) {
        return interaction.update({
          content: "Invalid vouch type.",
          components: []
        });
      }

      const voucherData = getVoucherData(guildId, voucherId);

      if (!voucherData[type].includes(targetId)) {
        return interaction.update({
          content: "That vouch could not be found.",
          components: []
        });
      }

      const roleId = interaction.values[0];

      const [targetMember, role, botMember] = await Promise.all([
        interaction.guild.members.fetch(targetId).catch(() => null),
        interaction.guild.roles.fetch(roleId).catch(() => null),
        interaction.guild.members.fetchMe().catch(() => null)
      ]);

      if (!targetMember || !role || !botMember) {
        return interaction.update({
          content: "The member or role could not be found.",
          components: []
        });
      }

      if (!targetMember.roles.cache.has(role.id)) {
        return interaction.update({
          content: "That member does not currently have the selected role. Your vouch was not removed.",
          components: []
        });
      }

      if (!role.editable) {
        return interaction.update({
          content: "ZOMB cannot remove that role because of its role hierarchy or permissions.",
          components: []
        });
      }

      await interaction.deferUpdate();

      try {
        await targetMember.roles.remove(
          role.id,
          `ZOMB older vouch removed by ${interaction.user.tag}`
        );

        const oldVouches = [...voucherData[type]];
        const savedRoles = getSavedVouchRoles(
          guildId,
          voucherId,
          type
        );
        const oldRoleId = savedRoles[targetId];

        voucherData[type] = voucherData[type].filter(
          id => id !== targetId
        );

        delete savedRoles[targetId];

        if (!saveAntiNukeData()) {
          voucherData[type] = oldVouches;

          if (oldRoleId) {
            savedRoles[targetId] = oldRoleId;
          }

          throw new Error("Could not save the vouch change.");
        }

        return interaction.editReply({
          content:
            `**OLDER VOUCH REMOVED**\n\n` +
            `**Member:** <@${targetId}>\n` +
            `**Position:** ${type.toUpperCase()}\n` +
            `**Role removed:** <@&${role.id}>\n` +
            "Your vouch slot has been restored.",
          components: []
        });
      } catch (error) {
        console.error("[ZOMB OLD VOUCH STRIP ERROR]", error);

        return interaction.editReply({
          content: "ZOMB could not complete the vouch removal. Check its permissions and try again.",
          components: []
        });
      }
    }

    // ==========================================
    // SLASH COMMANDS
    // ==========================================

    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === "ping") {
      return interaction.reply({
        content: `Latency: ${client.ws.ping}ms`,
        ephemeral: true
      });
    }

    if (interaction.commandName === "help") {
      return interaction.reply({
        content:
          "**ZOMB COMMANDS**\n\n" +
          "`~nuke` — Restart the current channel\n" +
          "`~vouch @member` — Start a Staff or Admin vouch\n" +
          "`~vouchlist` — View your vouch usage\n" +
          "`~stripstaff` — Remove a previous vouch\n" +
          "`~an` — Anti-Nuke help\n" +
          "`~an status` — View protection status\n" +
          "`~an trust @user` — Trust a member\n" +
          "`~an untrust @user` — Remove trust\n" +
          "`~an trustlist` — View trusted members\n" +
          "`~an enable` — Enable detection\n" +
          "`~an disable` — Disable detection\n" +
          "`~an antibot enable/disable` — Configure Anti-Bot\n" +
          "`~an punishment enable/disable` — Configure punishment",
        ephemeral: true
      });
    }
  } catch (error) {
    console.error("[ZOMB INTERACTION ERROR]", error);

    const response = {
      embeds: [
        zombEmbed(
          "ERROR",
          "ZOMB encountered an error while processing that interaction.",
          0x8B0000
        )
      ],
      ephemeral: true
    };

    if (interaction.deferred || interaction.replied) {
      await interaction.followUp(response).catch(() => {});
    } else {
      await interaction.reply(response).catch(() => {});
    }
  }
});

// ==========================================
// ZOMB SNIPE SYSTEM
// ==========================================

const snipeCache = new Map();
const SNIPE_LIMIT = 10;

client.on("messageDelete", async message => {
  try {
    console.log("[ZOMB SNIPE] Delete event detected:", message.id, "Partial:", message.partial);
    if (message.partial) {
      message = await message.fetch().catch(() => null);
    }

    if (!message || !message.guild || !message.author) return;

    const channelId = message.channel.id;

    if (!snipeCache.has(channelId)) {
      snipeCache.set(channelId, []);
    }

    const deletedMessages = snipeCache.get(channelId);

    deletedMessages.unshift({
      author: message.author.tag,
      authorId: message.author.id,
      content: message.content || "*No text content*",
      attachments: [...message.attachments.values()].map(a => a.url),
      deletedAt: Date.now()
    });
    console.log("[ZOMB SNIPE] Saved messages in channel:", deletedMessages.length);

    if (deletedMessages.length > SNIPE_LIMIT) {
      deletedMessages.length = SNIPE_LIMIT;
    }
  } catch (error) {
    console.error("[ZOMB SNIPE ERROR]", error);
  }
});

// ==========================================
// PREFIX COMMAND HANDLER
// ==========================================

client.on("messageCreate", async message => {
  // Convert all plain-text prefix replies into embeds.
  const originalMessageReply = message.reply.bind(message);
  message.reply = payload =>
    originalMessageReply(zombPayload(payload));

  checkAntiSpam(message).catch(error => {
    console.error("[ZOMB ANTISPAM ERROR]", error);
  });

  checkAntiLink(message).catch(error => {
    console.error("[ZOMB ANTILINK ERROR]", error);
  });

  checkAntiInvite(message).catch(error => {
    console.error("[ZOMB ANTI-INVITE ERROR]", error);
  });

  if (!message.guild || message.author.bot) return;

  const args = message.content.trim().split(/\s+/);
  const command = args[0].toLowerCase();
  
// ==========================================
// ZOMB SNIPE COMMANDS
// ==========================================

if (command === "~snipe" || command === "~s" || command === "~cs") {

  // CLEAR ALL SERVER SNIPES
  if (
    (command === "~snipe" && args[1]?.toLowerCase() === "clear" && args[2]?.toLowerCase() === "all") ||
    (command === "~cs" && args[1]?.toLowerCase() === "all")
  ) {
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return message.reply("❌ You need Administrator permission to clear all server snipes.");
    }

    let cleared = 0;

    message.guild.channels.cache.forEach(channel => {
      if (snipeCache.has(channel.id)) {
        snipeCache.delete(channel.id);
        cleared++;
      }
    });

    return message.reply(`✅ Cleared snipe history from ${cleared} server channels.`);
  }

  // CLEAR CURRENT CHANNEL
  if (
    (command === "~snipe" && args[1]?.toLowerCase() === "clear") ||
    command === "~cs"
  ) {
    const deleted = snipeCache.get(message.channel.id) || [];
    const count = deleted.length;

    snipeCache.delete(message.channel.id);

    return message.reply(`✅ Cleared ${count} saved snipes in this channel.`);
  }

  // DISPLAY SNIPE
  const requested = Number(args[1] || 1);

  if (!Number.isInteger(requested) || requested < 1 || requested > SNIPE_LIMIT) {
    return message.reply(
      `Choose a snipe number from 1 to ${SNIPE_LIMIT}. Usage: \`~snipe [number]\``
    );
  }

  const deletedMessages = snipeCache.get(message.channel.id) || [];
  const sniped = deletedMessages[requested - 1];

  if (!sniped) {
    return message.reply(
      `There isn't a deleted message #${requested} saved in this channel.`
    );
  }

  const embed = zombEmbed(
    `SNIPE ${requested}`,
    `**Author:** <@${sniped.authorId}> (${sniped.author})\n` +
    `**Deleted:** <t:${Math.floor(sniped.deletedAt / 1000)}:R>\n\n` +
    `**Message:**\n${sniped.content.slice(0, 3000)}`,
    0x5865F2
  );

  const imageUrl = sniped.attachments.find(url =>
    /\.(png|jpe?g|gif|webp)(\?.*)?$/i.test(url)
  );

  if (imageUrl) embed.setImage(imageUrl);

  if (sniped.attachments.length) {
    const attachmentText = sniped.attachments
      .map((url, index) => `[Attachment ${index + 1}](${url})`)
      .join("\n");

    embed.addFields({
      name: "Attachments",
      value: attachmentText.slice(0, 1000)
    });
  }

  return message.reply({ embeds: [embed] });
}

  if (command === "~tictactoe" || command === "~ttt") {
    console.log("[ZOMB COMMAND]", message.content);
  console.log("ZOMB DETECTED TIC TAC TOE COMMAND");
}
// ==========================================
// ZOMB HELP
// ==========================================

if (command === "~help") {
  return message.reply({
    embeds: [
      zombEmbed(
        "COMMAND CENTER",
        "**MODERATION**\n" +
        "`~ban @user/ID` — Permanently ban a member\n" +
        "`~unban USER_ID` — Unban a user\n" +
        "`~hardban @user/ID` — Ban and delete up to 7 days of messages\n" +
        "`~foreverban @user/ID` — Permanent hard ban\n" +
        "`~kick @user` — Kick a member\n" +
        "`~mute @user [duration]` — Timeout a member\n" +
        "`~timeout @user duration` — Set a timeout\n" +
        "`~unmute @user` — Remove a timeout\n" +
        "`~jail setup @role` — Configure the jail role\n" +
        "`~jail @user` — Jail a member\n" +
        "`~unjail @user` — Release a member\n\n" +
        "**FUN**\n" +
        "`~tictactoe @user` — Challenge someone to Tic-Tac-Toe\n" +
        "`~ttt @user` — Shortcut for Tic-Tac-Toe\n\n" +
        "`~snipe [number]` — View recently deleted messages\n" +
        "**VOUCH SYSTEM**\n" +
        "`~vouch @member` — Start a Staff or Admin vouch\n" +
        "`~vouchlist` — View your vouch usage\n" +
        "`~stripstaff` — Remove a previous vouch\n" +
        "`~vouchreset all` — Reset all vouch records (owner only)\n\n" +
        "**SECURITY**\n" +
        "`~an` — Anti-Nuke help\n" +
        "`~an status` — View security status\n" +
        "`~an trust @user` — Trust a member\n" +
        "`~an untrust @user` — Remove trust\n" +
        "`~an trustlist` — View trusted members\n" +
        "`~an enable/disable` — Configure detection\n" +
        "`~an antibot enable/disable` — Configure Anti-Bot\n" +
        "`~an punishment enable/disable` — Configure punishment",
        
        0x5865F2
      )
    ]
  });
}

// ==========================================
// TIC TAC TOE COMMAND
// ==========================================

if (command === "~tictactoe" || command === "~ttt") {
  const opponent = message.mentions.users.first();

  if (!opponent) {
    return message.reply("Usage: `~tictactoe @user`");
  }

  if (
    opponent.bot ||
    opponent.id === message.author.id
  ) {
    return message.reply("Choose another human member to play against.");
  }

  const gameId =
    `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

  const game = {
    players: {
      X: message.author.id,
      O: opponent.id
    },
    board: Array(9).fill(null),
    turn: "X",
    finished: false
  };

  ticTacToeGames.set(gameId, game);

  setTimeout(() => {
    ticTacToeGames.delete(gameId);
  }, 10 * 60 * 1000);

  return message.reply({
    content:
      `**ZOMB TIC TAC TOE**\n\n` +
      `❌ X: ${message.author}\n` +
      `⭕ O: ${opponent}\n\n` +
      `**Turn:** ${message.author} (X)`,
    components: buildTicTacToeRows(gameId, game)
  });
}

// ==========================================
// MODERATION TARGET HELPER
// ==========================================

const moderationTargetId =
  message.mentions.users.first()?.id ||
  args[1]?.replace(/[<@!>]/g, "");

const validModerationTarget =
  /^\d{17,20}$/.test(moderationTargetId || "");

// ==========================================
// BAN / HARDBAN / FOREVERBAN
// ==========================================

if (
  command === "~ban" ||
  command === "~hardban" ||
  command === "~foreverban"
) {
  if (
    !message.member.permissions.has(
      PermissionsBitField.Flags.BanMembers
    )
  ) {
    return message.reply("You need the Ban Members permission.");
  }

  const botMember = message.guild.members.me;

  if (
    !botMember?.permissions.has(
      PermissionsBitField.Flags.BanMembers
    )
  ) {
    return message.reply("ZOMB needs the Ban Members permission.");
  }

  if (!validModerationTarget) {
    return message.reply(
      `Usage: \`${command} @user\` or \`${command} USER_ID\``
    );
  }

  if (moderationTargetId === message.guild.ownerId) {
    return message.reply("The server owner cannot be banned.");
  }

  if (moderationTargetId === message.author.id) {
    return message.reply("You cannot ban yourself.");
  }

  const targetMember = await message.guild.members
    .fetch(moderationTargetId)
    .catch(() => null);

  if (
    targetMember &&
    message.author.id !== message.guild.ownerId &&
    targetMember.roles.highest.position >=
      message.member.roles.highest.position
  ) {
    return message.reply("You cannot ban someone with an equal or higher role.");
  }

  if (
    targetMember &&
    !targetMember.bannable
  ) {
    return message.reply("ZOMB cannot ban that member. Check role hierarchy.");
  }

  const targetUser = await client.users
    .fetch(moderationTargetId)
    .catch(() => null);

  if (!targetUser) {
    return message.reply("ZOMB could not find that Discord user.");
  }

  const hardBan =
    command === "~hardban" ||
    command === "~foreverban";

  const reason =
    args.slice(2).join(" ") ||
    `Action by ${message.author.tag}`;

  try {
    await message.guild.members.ban(moderationTargetId, {
      reason: `ZOMB ${command}: ${reason}`,
      deleteMessageSeconds: hardBan ? 604800 : 0
    });

    return message.reply({
      embeds: [
        zombEmbed(
          hardBan ? "HARDBAN SUCCESSFUL" : "BAN SUCCESSFUL",
          `**Member:** ${targetUser.tag}\n` +
          `**User ID:** ${moderationTargetId}\n` +
          `**Moderator:** ${message.author}\n` +
          `**Reason:** ${reason}\n` +
          `**Message deletion:** ${hardBan ? "Up to 7 days" : "None"}`,
          0xED4245
        )
      ]
    });
  } catch (error) {
    console.error("[ZOMB BAN ERROR]", error);
    return message.reply("ZOMB could not ban that user. Check its permissions.");
  }
}

// ==========================================
// UNBAN
// ==========================================

if (command === "~unban") {
  if (
    !message.member.permissions.has(
      PermissionsBitField.Flags.BanMembers
    )
  ) {
    return message.reply("You need the Ban Members permission.");
  }

  const userId = args[1]?.replace(/[<@!>]/g, "");

  if (!/^\d{17,20}$/.test(userId || "")) {
    return message.reply("Usage: `~unban USER_ID`");
  }

  try {
    await message.guild.members.unban(
      userId,
      `Unbanned by ${message.author.tag}`
    );

    return message.reply({
      embeds: [
        zombEmbed(
          "UNBAN SUCCESSFUL",
          `**User ID:** ${userId}\n**Moderator:** ${message.author}`,
          0x57F287
        )
      ]
    });
  } catch (error) {
    console.error("[ZOMB UNBAN ERROR]", error);
    return message.reply("Could not unban that user. Check the ID and ZOMB's permissions.");
  }
}

// ==========================================
// KICK
// ==========================================

if (command === "~kick") {
  if (
    !message.member.permissions.has(
      PermissionsBitField.Flags.KickMembers
    )
  ) {
    return message.reply("You need the Kick Members permission.");
  }

  if (!validModerationTarget) {
    return message.reply("Usage: `~kick @user` or `~kick USER_ID`");
  }

  const target = await message.guild.members
    .fetch(moderationTargetId)
    .catch(() => null);

  if (!target) {
    return message.reply("That member is not in this server.");
  }

  if (
    message.author.id !== message.guild.ownerId &&
    target.roles.highest.position >= message.member.roles.highest.position
  ) {
    return message.reply("You cannot kick someone with an equal or higher role.");
  }

  if (!target.kickable) {
    return message.reply("ZOMB cannot kick that member. Check its permissions and role hierarchy.");
  }

  const reason = args.slice(2).join(" ") || "No reason provided.";

  try {
    await target.kick(
      `ZOMB kick by ${message.author.tag}: ${reason}`
    );

    return message.reply({
      embeds: [
        zombEmbed(
          "KICK SUCCESSFUL",
          `**Member:** ${target.user.tag}\n` +
          `**Moderator:** ${message.author}\n` +
          `**Reason:** ${reason}`,
          0xED4245
        )
      ]
    });
  } catch (error) {
    console.error("[ZOMB KICK ERROR]", error);
    return message.reply("ZOMB could not kick that member.");
  }
}

// ==========================================
// MUTE / TIMEOUT
// ==========================================

if (command === "~mute" || command === "~timeout") {
  if (
    !message.member.permissions.has(
      PermissionsBitField.Flags.ModerateMembers
    )
  ) {
    return message.reply("You need the Moderate Members permission.");
  }

  if (!validModerationTarget) {
    return message.reply(
      `Usage: \`${command} @user ${command === "~mute" ? "[10m]" : "10m"}\``
    );
  }

  const target = await message.guild.members
    .fetch(moderationTargetId)
    .catch(() => null);

  if (!target) {
    return message.reply("That member is not in this server.");
  }

  if (
    message.author.id !== message.guild.ownerId &&
    target.roles.highest.position >= message.member.roles.highest.position
  ) {
    return message.reply("You cannot timeout someone with an equal or higher role.");
  }

  const durationText =
    command === "~mute" && !parseDuration(args[2])
      ? "10m"
      : args[2];

  const duration = parseDuration(durationText);

  if (!duration) {
    return message.reply(
      "Invalid duration. Use seconds, minutes, hours, or days, such as `30s`, `10m`, `2h`, or `1d`. Maximum: 28 days."
    );
  }

  if (!target.moderatable) {
    return message.reply("ZOMB cannot timeout that member. Check its permissions and role hierarchy.");
  }

  const reasonStart =
    command === "~mute" && durationText === "10m" && !parseDuration(args[2])
      ? 2
      : 3;

  const reason =
    args.slice(reasonStart).join(" ") || "No reason provided.";

  try {
    await target.timeout(
      duration,
      `ZOMB ${command}: ${reason}`
    );

    return message.reply({
      embeds: [
        zombEmbed(
          "TIMEOUT SUCCESSFUL",
          `**Member:** ${target.user.tag}\n` +
          `**Duration:** ${durationText}\n` +
          `**Moderator:** ${message.author}\n` +
          `**Reason:** ${reason}`,
          0xED4245
        )
      ]
    });
  } catch (error) {
    console.error("[ZOMB TIMEOUT ERROR]", error);
    return message.reply("ZOMB could not timeout that member.");
  }
}

// ==========================================
// UNMUTE
// ==========================================

if (command === "~unmute") {
  if (
    !message.member.permissions.has(
      PermissionsBitField.Flags.ModerateMembers
    )
  ) {
    return message.reply("You need the Moderate Members permission.");
  }

  if (!validModerationTarget) {
    return message.reply("Usage: `~unmute @user`");
  }

  const target = await message.guild.members
    .fetch(moderationTargetId)
    .catch(() => null);

  if (!target) {
    return message.reply("That member is not in this server.");
  }

  if (!target.moderatable) {
    return message.reply("ZOMB cannot remove that member's timeout.");
  }

  try {
    await target.timeout(
      null,
      `Timeout removed by ${message.author.tag}`
    );

    return message.reply({
      embeds: [
        zombEmbed(
          "TIMEOUT REMOVED",
          `**Member:** ${target.user.tag}\n**Moderator:** ${message.author}`,
          0x57F287
        )
      ]
    });
  } catch (error) {
    console.error("[ZOMB UNMUTE ERROR]", error);
    return message.reply("ZOMB could not remove that timeout.");
  }
}


// ==========================================
// JAIL SETUP / JAIL / UNJAIL
// ==========================================

if (command === "~jail" || command === "~unjail") {
  if (
    !message.member.permissions.has(
      PermissionsBitField.Flags.ManageRoles
    )
  ) {
    return message.reply("You need the Manage Roles permission.");
  }

  const guildId = message.guild.id;
  const botMember = message.guild.members.me;

  if (
    !botMember?.permissions.has(
      PermissionsBitField.Flags.ManageRoles
    ) ||
    !botMember.permissions.has(
      PermissionsBitField.Flags.ManageChannels
    )
  ) {
    return message.reply(
      "ZOMB needs Manage Roles and Manage Channels permissions."
    );
  }

  // JAIL SETUP
  if (
    command === "~jail" &&
    args[1]?.toLowerCase() === "setup"
  ) {
    const jailRole = message.mentions.roles.first();

    if (!jailRole) {
      return message.reply("Usage: `~jail setup @JailRole`");
    }

    if (
      jailRole.managed ||
      jailRole.position >= message.member.roles.highest.position ||
      jailRole.position >= botMember.roles.highest.position ||
      !jailRole.editable
    ) {
      return message.reply(
        "That jail role must be below your highest role and ZOMB's highest role."
      );
    }

    try {
      // Find an existing jail channel or create one
      let jailChannel = null;

      const savedChannelId = antiNukeData.jailChannels[guildId];

      if (savedChannelId) {
        jailChannel = await message.guild.channels
          .fetch(savedChannelId)
          .catch(() => null);
      }

      if (!jailChannel) {
        jailChannel = await message.guild.channels.create({
          name: "jail",
          type: 0,
          reason: "ZOMB jail system setup",
          permissionOverwrites: [
            {
              id: message.guild.roles.everyone.id,
              deny: [
                PermissionsBitField.Flags.ViewChannel
              ]
            },
            {
              id: jailRole.id,
              allow: [
                PermissionsBitField.Flags.ViewChannel,
                PermissionsBitField.Flags.SendMessages,
                PermissionsBitField.Flags.ReadMessageHistory
              ]
            },
            {
              id: botMember.id,
              allow: [
                PermissionsBitField.Flags.ViewChannel,
                PermissionsBitField.Flags.SendMessages,
                PermissionsBitField.Flags.ReadMessageHistory,
                PermissionsBitField.Flags.ManageChannels
              ]
            }
          ]
        });
      }

      // Make sure the jail role can access the jail channel
      await jailChannel.permissionOverwrites.edit(jailRole.id, {
        ViewChannel: true,
        SendMessages: true,
        ReadMessageHistory: true
      });

      // Give staff roles access to the jail channel
      for (const role of message.guild.roles.cache.values()) {
        if (
          role.id === message.guild.roles.everyone.id ||
          role.id === jailRole.id
        ) continue;

        const isStaff =
          role.permissions.has(
            PermissionsBitField.Flags.Administrator
          ) ||
          role.permissions.has(
            PermissionsBitField.Flags.ManageMessages
          ) ||
          role.permissions.has(
            PermissionsBitField.Flags.ManageRoles
          );

        if (isStaff) {
          await jailChannel.permissionOverwrites.edit(role.id, {
            ViewChannel: true,
            SendMessages: true,
            ReadMessageHistory: true
          });
        }
      }

      // Hide every other server channel from the jail role
      await message.guild.channels.fetch();

      for (const channel of message.guild.channels.cache.values()) {
        if (channel.id === jailChannel.id) continue;

        await channel.permissionOverwrites.edit(jailRole.id, {
          ViewChannel: false
        });
      }

      antiNukeData.jailRoles[guildId] = jailRole.id;
      antiNukeData.jailChannels[guildId] = jailChannel.id;

      if (!saveAntiNukeData()) {
        return message.reply(
          "The jail channel was configured, but ZOMB could not save the setup."
        );
      }

      return message.reply({
        embeds: [
          zombEmbed(
            "JAIL SYSTEM CONFIGURED",
            `**Jail role:** ${jailRole}\n` +
            `**Jail channel:** ${jailChannel}\n\n` +
            "Jailed members can access the jail channel. Other channels are hidden from the jail role.",
            0x57F287
          )
        ]
      });

    } catch (error) {
      console.error("[ZOMB JAIL SETUP ERROR]", error);
      return message.reply(
        "ZOMB could not finish jail setup. Check that it has Manage Channels and Manage Roles."
      );
    }
  }

  // JAIL / UNJAIL MEMBER
  if (!validModerationTarget) {
    return message.reply(
      command === "~jail"
        ? "Usage: `~jail @user`"
        : "Usage: `~unjail @user`"
    );
  }

  const target = await message.guild.members
    .fetch(moderationTargetId)
    .catch(() => null);

  if (!target) {
    return message.reply("That member is not in this server.");
  }

  if (
    message.author.id !== message.guild.ownerId &&
    target.roles.highest.position >= message.member.roles.highest.position
  ) {
    return message.reply(
      "You cannot manage someone with an equal or higher role."
    );
  }

  const jailRoleId = antiNukeData.jailRoles[guildId];
  const jailChannelId = antiNukeData.jailChannels[guildId];

  if (!jailRoleId || !jailChannelId) {
    return message.reply(
      "Jail is not configured. Use `~jail setup @jailed` first."
    );
  }

  const jailRole = await message.guild.roles
    .fetch(jailRoleId)
    .catch(() => null);

  const jailChannel = await message.guild.channels
    .fetch(jailChannelId)
    .catch(() => null);

  if (!jailRole || !jailRole.editable) {
    return message.reply(
      "The configured jail role is missing or cannot be managed by ZOMB."
    );
  }

  if (!jailChannel) {
    return message.reply(
      "The jail channel is missing. Run `~jail setup @jailed` again."
    );
  }

  try {
    if (command === "~jail") {
      if (target.roles.cache.has(jailRole.id)) {
        return message.reply("That member is already jailed.");
      }

      await target.roles.add(
        jailRole,
        `Jailed by ${message.author.tag}`
      );

      await jailChannel.send({
        embeds: [
          zombEmbed(
            "MEMBER JAILED",
            `**Member:** ${target}\n` +
            `**Moderator:** ${message.author}\n\n` +
            "This member has been placed in jail.",
            0xED4245
          )
        ]
      });

      return message.reply({
        embeds: [
          zombEmbed(
            "MEMBER JAILED",
            `**Member:** ${target.user.tag}\n` +
            `**Jail role:** ${jailRole}\n` +
            `**Jail channel:** ${jailChannel}\n` +
            `**Moderator:** ${message.author}`,
            0xED4245
          )
        ]
      });
    }

    if (!target.roles.cache.has(jailRole.id)) {
      return message.reply("That member does not have the jail role.");
    }

    await target.roles.remove(
      jailRole,
      `Released by ${message.author.tag}`
    );

    await jailChannel.send({
      embeds: [
        zombEmbed(
          "MEMBER RELEASED",
          `**Member:** ${target}\n` +
          `**Moderator:** ${message.author}`,
          0x57F287
        )
      ]
    });

    return message.reply({
      embeds: [
        zombEmbed(
          "MEMBER RELEASED",
          `**Member:** ${target.user.tag}\n` +
          `**Moderator:** ${message.author}`,
          0x57F287
        )
      ]
    });

  } catch (error) {
    console.error("[ZOMB JAIL ERROR]", error);
    return message.reply(
      "ZOMB could not complete the jail action. Check its role hierarchy and channel permissions."
    );
  }
}

  // ==========================================
  // ZOMB CHANNEL NUKE
  // ==========================================

  if (command === "~nuke") {
    if (message.author.id !== message.guild.ownerId) {
      return message.reply("Only the server owner can use this command.");
    }

    if (message.channel.isThread()) {
      return message.reply("You cannot restart a thread.");
    }

    const botMember = message.guild.members.me;

    if (
      !botMember ||
      !botMember.permissions.has(
        PermissionsBitField.Flags.ManageChannels
      )
    ) {
      return message.reply("ZOMB needs Manage Channels permission.");
    }

    if (
      !message.channel.deletable ||
      !message.channel.manageable
    ) {
      return message.reply("ZOMB cannot delete or clone this channel. Check its permissions.");
    }

    const oldChannel = message.channel;
    let prompt;

    try {
      prompt = await message.reply(
        "**CHANNEL RESTART CONFIRMATION**\n\n" +
        "React with 💣 within 5 seconds to confirm.\n" +
        "If you do not react, the operation will be cancelled."
      );

      await prompt.react("💣");

      const collected = await prompt.awaitReactions({
        filter: (reaction, user) =>
          reaction.emoji.name === "💣" &&
          user.id === message.guild.ownerId,
        max: 1,
        time: 5000
      });

      if (!collected.size) {
        await prompt.edit({
          embeds: [
            zombEmbed(
              "CHANNEL RESTART CANCELLED",
              "The confirmation time expired."
            )
          ],
          content: null
        });

        return;
      }

      const newChannel = await oldChannel.clone({
        reason: `Channel restart requested by ${message.author.tag}`
      });

      try {
        await oldChannel.delete(
          "ZOMB channel restart confirmed"
        );
      } catch (error) {
        console.error("[ZOMB NUKE DELETE ERROR]", error);

        await newChannel.delete(
          "ZOMB restart rollback because original channel could not be deleted"
        ).catch(() => {});

        throw error;
      }

      await newChannel.send({
        embeds: [
          zombEmbed(
            "CHANNEL RESTARTED",
            "This channel has been successfully restarted."
          )
        ]
      });
    } catch (error) {
      console.error("[ZOMB NUKE ERROR]", error);

      await message.channel.send({
        embeds: [
          zombEmbed(
            "CHANNEL RESTART FAILED",
            "ZOMB could not complete the channel restart. Check its permissions.",
            0x8B0000
          )
        ]
      }).catch(() => {});
    }

    return;
  }

  // ==========================================
  // ZOMB VOUCH COMMAND
  // ==========================================

  if (command === "~vouch") {
    const guildId = message.guild.id;
    const trusted = antiNukeData.trusted[guildId] || [];

    if (!isTrusted(guildId, message.author.id, message.guild.ownerId)) {
      return message.reply("Only trusted members can use the vouch system.");
    }

    const targetUser = message.mentions.users.first();

    if (!targetUser) {
      return message.reply(
        "**ZOMB VOUCH COMMANDS**\n\n" +
        "`~vouch @member` — Start a Staff or Admin vouch.\n" +
        "`~vouchlist` — View your vouch usage.\n" +
        "`~stripstaff` — Remove a previous vouch and its assigned role.\n\n" +
        "**VOUCH LIMITS**\n" +
        "Staff: 3 vouches\n" +
        "Admin: 2 vouches\n\n" +
        "**HOW IT WORKS**\n" +
        "1. Mention a member with `~vouch @member`.\n" +
        "2. Select Staff or Admin.\n" +
        "3. Select the role you want to give.\n" +
        "4. ZOMB assigns the role and records the vouch."
      );
    }

    if (
      targetUser.bot ||
      targetUser.id === message.author.id ||
      targetUser.id === message.guild.ownerId
    ) {
      return message.reply("You cannot vouch for that member.");
    }

    getVoucherData(guildId, message.author.id);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(
          `zomb_vouch_type|${guildId}|${message.author.id}|${targetUser.id}|staff`
        )
        .setLabel("Staff")
       .setStyle(ButtonStyle.Success),

      new ButtonBuilder()
        .setCustomId(
          `zomb_vouch_type|${guildId}|${message.author.id}|${targetUser.id}|admin`
        )
        .setLabel("Admin")
        .setStyle(ButtonStyle.Danger)
    );

    return message.reply({
      content:
        `**ZOMB VOUCH SYSTEM**\n\n` +
        `**Member:** ${targetUser}\n\n` +
        "Choose the position you want to vouch for:",
      components: [row]
    });
  }

  // ==========================================
  // ZOMB VOUCH LIST
  // ==========================================

  if (command === "~vouchlist") {
    const guildId = message.guild.id;

    if (!isTrusted(guildId, message.author.id, message.guild.ownerId)) {
      return message.reply("Only trusted members can view their vouch usage.");
    }

    const voucherData = getVoucherData(
      guildId,
      message.author.id
    );

    const staffUsed = voucherData.staff.length;
    const adminUsed = voucherData.admin.length;

    return message.reply(
      `**VOUCH USAGE**\n\n` +
      `**Staff:** ${staffUsed}/${VOUCH_LIMITS.staff}\n` +
      `**Staff remaining:** ${VOUCH_LIMITS.staff - staffUsed}\n\n` +
      `**Admin:** ${adminUsed}/${VOUCH_LIMITS.admin}\n` +
      `**Admin remaining:** ${VOUCH_LIMITS.admin - adminUsed}`
    );
  }

  // ==========================================
  // ZOMB STRIPSTAFF COMMAND
  // ==========================================

  if (command === "~stripstaff") {
    const guildId = message.guild.id;

    if (!isTrusted(guildId, message.author.id, message.guild.ownerId)) {
      return message.reply("Only trusted members can use this command.");
    }

    const voucherData =
      antiNukeData.vouches?.[guildId]?.[message.author.id];

    if (!voucherData) {
      return message.reply("You have no vouches to remove.");
    }

    const options = [];

    for (const type of ["staff", "admin"]) {
      for (const targetId of voucherData[type] || []) {
        const target = await message.guild.members
          .fetch(targetId)
          .catch(() => null);

        if (!target) continue;

        const roleId =
          antiNukeData.vouchRoles?.[guildId]?.[message.author.id]?.[type]?.[targetId];

        const role = roleId
          ? await message.guild.roles.fetch(roleId).catch(() => null)
          : null;

        options.push({
          label: `${type.toUpperCase()} - ${target.user.username}`.slice(0, 100),
          description: role
            ? `Remove the ${role.name} role`
            : "Previous vouch - role information unavailable",
          value: `${type}:${targetId}`
        });
      }
    }

    if (options.length === 0) {
      return message.reply("You have no active vouches to remove.");
    }

    const menu = new StringSelectMenuBuilder()
      .setCustomId(
        `zomb_strip|${guildId}|${message.author.id}`
      )
      .setPlaceholder("Select a member whose vouch you want to remove")
      .addOptions(options.slice(0, 25));

    return message.reply({
      content: "**ZOMB STRIPSTAFF**\nSelect a member to remove your vouch from:",
      components: [
        new ActionRowBuilder().addComponents(menu)
      ]
    });
  }

  // ==========================================
  // VOUCH RESET — SERVER OWNER ONLY
  // ==========================================

  if (command === "~vouchreset") {
    if (message.author.id !== message.guild.ownerId) {
      return message.reply(
        "Only the server owner can use this command."
      );
    }

    const target = message.mentions.users.first();
    const resetAll = args[1]?.toLowerCase() === "all";

    if (!resetAll && !target) {
      return message.reply(
        "**ZOMB VOUCH RESET**\n\n" +
        "`~vouchreset @member` — Reset one trusted member's vouches.\n" +
        "`~vouchreset all` — Reset everyone's vouches."
      );
    }

    const guildId = message.guild.id;

    antiNukeData.vouches[guildId] ||= {};
    antiNukeData.vouchRoles[guildId] ||= {};

    const oldVouches = {
      ...antiNukeData.vouches[guildId]
    };

    const oldRoles = {
      ...antiNukeData.vouchRoles[guildId]
    };

    if (resetAll) {
      antiNukeData.vouches[guildId] = {};
      antiNukeData.vouchRoles[guildId] = {};
    } else {
      delete antiNukeData.vouches[guildId][target.id];
      delete antiNukeData.vouchRoles[guildId][target.id];
    }

    if (!saveAntiNukeData()) {
      antiNukeData.vouches[guildId] = oldVouches;
      antiNukeData.vouchRoles[guildId] = oldRoles;

      return message.reply(
        "ZOMB could not save the reset. No vouch records were changed."
      );
    }

    return message.reply({
      embeds: [
        zombEmbed(
          "VOUCH RESET SUCCESSFUL",
          resetAll
            ? "All trusted members' Staff and Admin vouch records have been reset."
            : `The Staff and Admin vouch records for <@${target.id}> have been reset.`,
          0x57F287
        ).setFooter({
          text: "Existing Discord roles were not removed."
        })
      ]
    });
  }

  // ==========================================
  // ANTI-NUKE COMMANDS
  // ==========================================

  if (command !== "~an" && command !== "~antinuke") return;

  if (message.author.id !== message.guild.ownerId) {
    return message.reply("Only the server owner can manage ZOMB's anti-nuke system.");
  }

  const action = (args[1] || "").toLowerCase();
  const guildId = message.guild.id;

  // ==========================================
  // ANTI-BOT SETTINGS
  // ==========================================

  if (action === "antibot") {
    const setting = (args[2] || "").toLowerCase();

    if (setting === "enable") {
      antiNukeData.antiBot[guildId] = true;
      saveAntiNukeData();

      return message.reply("Anti-Bot protection has been enabled.");
    }

    if (setting === "disable") {
      antiNukeData.antiBot[guildId] = false;
      saveAntiNukeData();

      return message.reply("Anti-Bot protection has been disabled.");
    }

    return message.reply(
      "Usage: `~an antibot enable` or `~an antibot disable`"
    );
  }

  if (!Array.isArray(antiNukeData.trusted[guildId])) {
    antiNukeData.trusted[guildId] = [];
  }

  const trustedList = antiNukeData.trusted[guildId];

  // ==========================================
  // TRUST MEMBER
  // ==========================================

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
      return message.reply("Invalid user. You cannot trust bots or yourself.");
    }

    if (trustedList.includes(userId)) {
      return message.reply("This member is already trusted.");
    }

    trustedList.push(userId);

    if (!saveAntiNukeData()) {
      trustedList.pop();
      return message.reply("ZOMB could not save the trust change.");
    }

    return message.reply(
      `${trustedUser.username} is now trusted by ZOMB.`
    );
  }

  // ==========================================
  // UNTRUST MEMBER
  // ==========================================

  if (action === "untrust") {
    const userId =
      message.mentions.users.first()?.id ||
      args[2]?.match(/^\d{17,20}$/)?.[0];

    if (!userId) {
      return message.reply(
        "Usage: `~an untrust @user` or `~an untrust USER_ID`"
      );
    }

    if (!trustedList.includes(userId)) {
      return message.reply("This member is not trusted.");
    }

    const oldTrustedList = [...trustedList];

    antiNukeData.trusted[guildId] =
      trustedList.filter(id => id !== userId);

    if (!saveAntiNukeData()) {
      antiNukeData.trusted[guildId] = oldTrustedList;
      return message.reply("ZOMB could not save the trust change.");
    }

    return message.reply(
      `<@${userId}> was removed from the ZOMB trust team.`
    );
  }

  // ==========================================
  // TRUST LIST
  // ==========================================

  if (action === "trustlist") {
    if (trustedList.length === 0) {
      return message.reply("The ZOMB trusted team is currently empty.");
    }

    const members = await Promise.all(
      trustedList.map(id =>
        client.users.fetch(id).catch(() => null)
      )
    );

    const usernames = members
      .filter(Boolean)
      .map(user => `• ${user.username}`);

    return message.reply({
      embeds: [
        zombEmbed(
          "TRUST TEAM",
          usernames.join("\n")
        )
      ]
    });
  }

  // ==========================================
  // ENABLE DETECTION
  // ==========================================

  if (action === "enable") {
    antiNukeData.enabled[guildId] = true;

    if (!saveAntiNukeData()) {
      antiNukeData.enabled[guildId] = false;
      return message.reply("ZOMB could not save this setting.");
    }

    return message.reply("Anti-Nuke detection has been enabled.");
  }

  // ==========================================
  // DISABLE DETECTION
  // ==========================================

  if (action === "disable") {
    antiNukeData.enabled[guildId] = false;

    if (!saveAntiNukeData()) {
      antiNukeData.enabled[guildId] = true;
      return message.reply("ZOMB could not save this setting.");
    }

    return message.reply("Anti-Nuke detection has been disabled.");
  }

  // ==========================================
  // AUTOMATIC PUNISHMENT
  // ==========================================

  if (action === "punishment") {
    const setting = (args[2] || "").toLowerCase();

    if (setting === "enable") {
      antiNukeData.punishment[guildId] = true;
      saveAntiNukeData();

      return message.reply("Automatic punishment has been enabled.");
    }

    if (setting === "disable") {
      antiNukeData.punishment[guildId] = false;
      saveAntiNukeData();

      return message.reply("Automatic punishment has been disabled.");
    }

    return message.reply(
      "Usage: `~an punishment enable` or `~an punishment disable`"
    );
  }

  // ==========================================
  // STATUS
  // ==========================================

  if (action === "status") {
    const enabled =
      antiNukeData.enabled[guildId] === true;

    const punishment =
      antiNukeData.punishment[guildId] === true;

    const antiBot =
      antiNukeData.antiBot[guildId] === true;

    return message.reply(
      `**SECURITY STATUS**\n\n` +
      `**Detection:** ${enabled ? "ENABLED" : "DISABLED"}\n` +
      `**Automatic Punishment:** ${punishment ? "ENABLED" : "DISABLED"}\n` +
      `**Anti-Bot:** ${antiBot ? "ENABLED" : "DISABLED"}\n` +
      `**Trusted Members:** ${trustedList.length}`
    );
  }

  // ==========================================
  // SET LOG CHANNEL
  // ==========================================

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
      return message.reply("ZOMB cannot access that logging channel.");
    }

    antiNukeData.logs[guildId] = channelId;

    if (!saveAntiNukeData()) {
      delete antiNukeData.logs[guildId];
      return message.reply("ZOMB could not save the logging channel.");
    }

    const sent = await sendAntiNukeLog(
      message.guild,
      "LOGGING TEST",
      "ZOMB successfully connected to this security log channel."
    );

    if (!sent) {
      return message.reply(
        "The channel was saved, but ZOMB could not send the test embed. Check its channel permissions."
      );
    }

    return message.reply(
      `Logging has been configured successfully in ${logChannel}.`
    );
  }

  // ==========================================
  // HELP
  // ==========================================

  return message.reply(
    "**ZOMB SECURITY COMMANDS**\n\n" +
    "`~vouch @member` — Start a Staff or Admin vouch\n" +
    "`~vouchlist` — View your vouch usage\n" +
    "`~stripstaff` — Remove a previous vouch\n" +
    "`~an trust @user` — Trust a member\n" +
    "`~an untrust @user` — Remove a trusted member\n" +
    "`~an trustlist` — View trusted members\n" +
    "`~an enable` — Enable detection\n" +
    "`~an disable` — Disable detection\n" +
    "`~an antibot enable/disable` — Anti-Bot settings\n" +
    "`~an punishment enable/disable` — Punishment settings\n" +
    "`~an status` — View security status\n" +
    "`~an setlog #channel` — Set logging channel"
  );
});

// ==========================================
// BOT READY
// ==========================================

client.once("clientReady", () => {
  console.log(`[ZOMB] Online as ${client.user.tag}`);
});

// ==========================================
// START ZOMB
// ==========================================

async function start() {
  if (!process.env.DISCORD_TOKEN) {
    throw new Error("DISCORD_TOKEN environment variable is missing.");
  }

  await registerCommands();
  await client.login(process.env.DISCORD_TOKEN);
}

start().catch(error => {
  console.error("[ZOMB START ERROR]", error);
});
