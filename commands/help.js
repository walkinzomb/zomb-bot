
const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('View all ZOMB commands'),

  async execute(interaction) {
    await interaction.reply({
      content:
        '🐺 **ZOMB COMMAND CENTER**\n\n' +
        '**General Commands**\n' +
        '`/ping` — Check bot response\n' +
        '`/help` — View available commands\n\n' +
        'More ZOMB features coming soon.',
      ephemeral: true
    });
  }
};
