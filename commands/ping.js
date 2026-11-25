
const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Check ZOMB response time'),

  async execute(interaction) {
    const latency = Date.now() - interaction.createdTimestamp;

    await interaction.reply({
      content: `🏓 **ZOMB is online!**\nResponse time: ${latency}ms`,
      ephemeral: true
    });
  }
};
