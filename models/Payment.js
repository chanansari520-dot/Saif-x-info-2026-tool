const mongoose = require('mongoose');

const PaymentSchema = new mongoose.Schema({
    userEmail: { type: String, required: true },
    amount: { type: Number, required: true },
    credits: { type: Number, required: true },
    utr: { type: String, required: true, unique: true },
    status: { type: String, default: 'pending' },
    screenshot: { type: String, default: null },
    approvedBy: { type: String, default: null },
    approvedAt: { type: Date, default: null },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Payment', PaymentSchema);
