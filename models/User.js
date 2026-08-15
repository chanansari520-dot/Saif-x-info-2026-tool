const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    credits: { type: Number, default: 2 },
    plan: { type: String, default: 'free' },
    referralCode: { type: String, unique: true, sparse: true },
    referredBy: { type: String, default: null },
    referredCount: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('User', UserSchema);
