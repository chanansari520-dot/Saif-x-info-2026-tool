const mongoose = require('mongoose');

const SettingsSchema = new mongoose.Schema({
    heroTitle: { type: String, default: 'Free Indian +91 Checker' },
    heroSubtitle: { type: String, default: 'Get Name, Address, Circle & more for any 10-digit Indian number or Aadhaar.' },
    heroDescription: { type: String, default: 'Verify mobile number or Aadhaar instantly.' },
    pricingHeading: { type: String, default: '💰 Choose Your Pack' },
    pricingDescription: { type: String, default: 'Pay via UPI — amount auto-filled. Credits add after admin approval.' },
    footerText: { type: String, default: '© 2026 SAIF X INFO — Made in India 🇮🇳 for Indian numbers.' },
    updatedAt: { type: Date, default: Date.now }
}, { collection: 'appsettings' });

SettingsSchema.statics.getSettings = async function() {
    let settings = await this.findOne();
    if (!settings) {
        settings = new this();
        await settings.save();
    }
    return settings;
};

module.exports = mongoose.model('Settings', SettingsSchema);
