require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const axios = require('axios');

const User = require('./models/User');
const Payment = require('./models/Payment');
const { Music, PlaylistState } = require('./models/Music');
const Settings = require('./models/Settings');

const app = express();
app.use(cors({ origin: '*', credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

// ---------- MONGODB (Graceful Handling) ----------
const MONGODB_URI = process.env.MONGODB_URI;
let isMongoConnected = false;

if (!MONGODB_URI) {
    console.log('⚠️ MONGODB_URI not set. Running in limited mode.');
} else {
    mongoose.connect(MONGODB_URI, {
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000,
    })
    .then(() => {
        console.log('✅ MongoDB connected');
        isMongoConnected = true;
    })
    .catch(err => {
        console.error('❌ MongoDB connection error:', err.message);
        console.log('⚠️ Continuing without database');
    });
}

// ---------- TELEGRAM ----------
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

async function sendTelegramMessage(message) {
    if (!BOT_TOKEN || !CHAT_ID) return;
    try {
        await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            chat_id: CHAT_ID,
            text: message,
            parse_mode: 'HTML'
        });
    } catch (e) { console.log('Telegram error:', e.message); }
}

async function sendTelegramPhoto(photoUrl, caption = '') {
    if (!BOT_TOKEN || !CHAT_ID) return;
    try {
        await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, {
            chat_id: CHAT_ID,
            photo: photoUrl,
            caption,
            parse_mode: 'HTML'
        });
    } catch (e) { console.log('Telegram photo error:', e.message); }
}

// ---------- AUTH MIDDLEWARE ----------
const authMiddleware = async (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback-secret-key');
        if (!isMongoConnected) {
            return res.status(503).json({ error: 'Database unavailable. Try again later.' });
        }
        req.user = await User.findById(decoded.id);
        if (!req.user) return res.status(401).json({ error: 'User not found' });
        next();
    } catch (err) {
        res.status(401).json({ error: 'Invalid token' });
    }
};

// ---------- REGISTER ----------
app.post('/api/auth/register', async (req, res) => {
    if (!isMongoConnected) {
        return res.status(503).json({ error: 'Database unavailable. Try again later.' });
    }
    const { email, password, referralCode } = req.body;
    const existing = await User.findOne({ email });
    if (existing) return res.status(400).json({ error: 'Email already exists' });

    const hashed = await bcrypt.hash(password, 10);
    const generateReferralCode = () => {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let code = '';
        for (let i = 0; i < 8; i++) code += chars[Math.floor(Math.random() * chars.length)];
        return code;
    };
    let referralCodeFinal = generateReferralCode();
    while (await User.findOne({ referralCode: referralCodeFinal })) {
        referralCodeFinal = generateReferralCode();
    }

    let referredBy = null;
    let referrerUser = null;
    if (referralCode) {
        referrerUser = await User.findOne({ referralCode: referralCode.toUpperCase().trim() });
        if (referrerUser) {
            referredBy = referralCode.toUpperCase().trim();
            referrerUser.credits += 5;
            referrerUser.referredCount += 1;
            await referrerUser.save();
        }
    }

    const user = new User({
        email,
        password: hashed,
        referralCode: referralCodeFinal,
        referredBy,
        credits: 2
    });
    await user.save();

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET || 'fallback-secret-key');

    await sendTelegramMessage(`
🆕 <b>New User Registered!</b>
👤 Email: ${email}
🔗 Referral Code: ${referralCodeFinal}
${referrerUser ? `🎁 Referred By: ${referrerUser.email}` : ''}
    `);

    res.json({ token, credits: user.credits, plan: user.plan, referralCode: user.referralCode, referredBy: user.referredBy });
});

// ---------- LOGIN ----------
app.post('/api/auth/login', async (req, res) => {
    if (!isMongoConnected) {
        return res.status(503).json({ error: 'Database unavailable. Try again later.' });
    }
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET || 'fallback-secret-key');
    res.json({ token, credits: user.credits, plan: user.plan, referralCode: user.referralCode, referredBy: user.referredBy });
});

// ---------- PROFILE ----------
app.get('/api/user/profile', authMiddleware, async (req, res) => {
    res.json({
        email: req.user.email,
        credits: req.user.credits,
        plan: req.user.plan,
        referralCode: req.user.referralCode,
        referredBy: req.user.referredBy,
        referredCount: req.user.referredCount || 0
    });
});

// ---------- PHONE LOOKUP ----------
app.post('/api/lookup', authMiddleware, async (req, res) => {
    const { number } = req.body;
    if (!/^[6-9]\d{9}$/.test(number)) {
        return res.status(400).json({ error: 'Invalid Indian number' });
    }
    if (req.user.credits <= 0) {
        return res.status(402).json({ error: 'Insufficient credits' });
    }

    try {
        const url = `${process.env.YOUR_API_URL}?number=${number}&key=${process.env.YOUR_API_KEY}`;
        const response = await axios.get(url, { timeout: 15000 });
        const data = response.data;

        if (data.status !== 'success' || !data.result || data.result.length === 0) {
            return res.status(404).json({ error: 'No data found for this number' });
        }

        req.user.credits -= 1;
        await req.user.save();

        res.json({
            success: true,
            creditsRemaining: req.user.credits,
            result: data.result[0]
        });
    } catch (error) {
        console.error('Lookup error:', error.message);
        res.status(500).json({ error: 'Failed to fetch details' });
    }
});

// ---------- AADHAAR LOOKUP (WITH 3 RETRIES) ----------
app.post('/api/lookup/aadhar', authMiddleware, async (req, res) => {
    const { aadhar } = req.body;
    if (!/^\d{12}$/.test(aadhar)) {
        return res.status(400).json({ error: 'Invalid Aadhaar number. Must be 12 digits.' });
    }
    if (req.user.credits <= 0) {
        return res.status(402).json({ error: 'Insufficient credits' });
    }

    const maxRetries = 3;
    const delay = 500;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const url = `${process.env.YOUR_API_URL.replace('/search/number', '/search/aadhar')}?aadhar=${aadhar}&key=${process.env.YOUR_API_KEY}`;
            const response = await axios.get(url, { timeout: 15000 });
            const data = response.data;

            if (data.status === 'success' && data.result && data.result.length > 0) {
                req.user.credits -= 1;
                await req.user.save();
                return res.json({
                    success: true,
                    creditsRemaining: req.user.credits,
                    result: data.result[0]
                });
            }
            console.log(`Attempt ${attempt}: No data for Aadhaar ${aadhar}`);
        } catch (error) {
            console.error(`Attempt ${attempt} error:`, error.message);
        }
        if (attempt < maxRetries) {
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
    return res.status(404).json({ error: 'No data found after multiple attempts. Your credit is safe.' });
});

// ---------- PAYMENT SUBMIT ----------
app.post('/api/payment/submit', authMiddleware, async (req, res) => {
    const { utr, amount, creditsToAdd, screenshot } = req.body;
    if (!utr || utr.length < 6) {
        return res.status(400).json({ error: 'Invalid UTR' });
    }

    const existing = await Payment.findOne({ utr });
    if (existing) {
        return res.status(400).json({ error: 'UTR already submitted. Wait for admin approval.' });
    }

    const payment = new Payment({
        userEmail: req.user.email,
        amount,
        credits: creditsToAdd,
        utr,
        screenshot: screenshot || null,
        status: 'pending'
    });
    await payment.save();

    await sendTelegramMessage(`
💰 <b>New Payment Request!</b>
👤 User: ${req.user.email}
💵 Amount: ₹${amount}
📊 Credits: ${creditsToAdd} searches
🔢 UTR: <code>${utr}</code>
⏳ Status: PENDING APPROVAL
    `);
    if (screenshot) {
        await sendTelegramPhoto(screenshot, `📸 Payment Screenshot for UTR: ${utr}`);
    }

    res.json({ success: true, message: 'Payment submitted for approval.' });
});

// ---------- ADMIN: PENDING PAYMENTS ----------
app.get('/api/admin/payments/pending', authMiddleware, async (req, res) => {
    if (req.user.email !== 'mdabusaifansari96@gmail.com') {
        return res.status(403).json({ error: 'Admin only' });
    }
    const payments = await Payment.find({ status: 'pending' }).sort({ createdAt: -1 });
    res.json({ payments });
});

// ---------- ADMIN: APPROVE PAYMENT ----------
app.post('/api/admin/payments/approve', authMiddleware, async (req, res) => {
    if (req.user.email !== 'mdabusaifansari96@gmail.com') {
        return res.status(403).json({ error: 'Admin only' });
    }
    const { paymentId } = req.body;
    const payment = await Payment.findById(paymentId);
    if (!payment) return res.status(404).json({ error: 'Payment not found' });
    if (payment.status !== 'pending') {
        return res.status(400).json({ error: 'Already processed' });
    }

    const user = await User.findOne({ email: payment.userEmail });
    if (!user) return res.status(404).json({ error: 'User not found' });

    user.credits += payment.credits;
    await user.save();

    payment.status = 'approved';
    payment.approvedBy = req.user.email;
    payment.approvedAt = new Date();
    await payment.save();

    await sendTelegramMessage(`
✅ <b>Payment Approved!</b>
👤 User: ${payment.userEmail}
💵 Amount: ₹${payment.amount}
📊 Credits Added: ${payment.credits}
🔢 UTR: <code>${payment.utr}</code>
👮 Approved By: ${req.user.email}
🎉 User now has ${user.credits} credits.
    `);

    res.json({ success: true, message: 'Payment approved' });
});

// ---------- ADMIN: REJECT PAYMENT ----------
app.post('/api/admin/payments/reject', authMiddleware, async (req, res) => {
    if (req.user.email !== 'mdabusaifansari96@gmail.com') {
        return res.status(403).json({ error: 'Admin only' });
    }
    const { paymentId, reason } = req.body;
    const payment = await Payment.findById(paymentId);
    if (!payment) return res.status(404).json({ error: 'Payment not found' });
    if (payment.status !== 'pending') {
        return res.status(400).json({ error: 'Already processed' });
    }

    payment.status = 'rejected';
    payment.approvedBy = req.user.email;
    payment.approvedAt = new Date();
    await payment.save();

    await sendTelegramMessage(`
❌ <b>Payment Rejected!</b>
👤 User: ${payment.userEmail}
💵 Amount: ₹${payment.amount}
🔢 UTR: <code>${payment.utr}</code>
📝 Reason: ${reason || 'Payment verification failed'}
👮 Rejected By: ${req.user.email}
    `);

    res.json({ success: true, message: 'Payment rejected' });
});

// ---------- MUSIC: UPLOAD ----------
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = './uploads/music/';
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        const unique = Date.now() + '-' + file.originalname.replace(/\s/g, '_');
        cb(null, unique);
    }
});
const upload = multer({
    storage,
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('audio/')) cb(null, true);
        else cb(new Error('Only audio files allowed'));
    }
});

app.post('/api/admin/music/upload', authMiddleware, upload.array('songs', 50), async (req, res) => {
    if (req.user.email !== 'mdabusaifansari96@gmail.com') {
        return res.status(403).json({ error: 'Admin only' });
    }
    if (!req.files || req.files.length === 0) {
        return res.status(400).json({ error: 'No files uploaded' });
    }

    const saved = [];
    for (const file of req.files) {
        const song = new Music({
            title: path.parse(file.originalname).name,
            filename: file.filename,
            filepath: `/uploads/music/${file.filename}`
        });
        await song.save();
        saved.push(song);
    }

    let state = await PlaylistState.findOne();
    if (!state) {
        state = new PlaylistState();
        await state.save();
    }

    await sendTelegramMessage(`🎵 <b>${saved.length} songs uploaded.</b>\n${saved.map(s => `• ${s.title}`).join('\n')}`);

    res.json({ success: true, message: `${saved.length} songs uploaded`, songs: saved });
});

// ---------- MUSIC: PLAYLIST ----------
app.get('/api/music/playlist', async (req, res) => {
    const songs = await Music.find().sort({ createdAt: 1 });
    const state = await PlaylistState.findOne();
    res.json({ songs, state: state || { isPlaying: false, currentIndex: 0, currentTime: 0 } });
});

// ---------- MUSIC: CONTROL ----------
app.post('/api/admin/music/control', authMiddleware, async (req, res) => {
    if (req.user.email !== 'mdabusaifansari96@gmail.com') {
        return res.status(403).json({ error: 'Admin only' });
    }
    const { action, index, time } = req.body;
    let state = await PlaylistState.findOne();
    if (!state) {
        state = new PlaylistState();
        await state.save();
    }
    const playlist = await Music.find().sort({ createdAt: 1 });
    if (playlist.length === 0) {
        return res.status(400).json({ error: 'No songs in playlist' });
    }

    switch (action) {
        case 'play':
            state.isPlaying = true;
            if (index !== undefined && index >= 0 && index < playlist.length) state.currentIndex = index;
            break;
        case 'pause':
            state.isPlaying = false;
            break;
        case 'stop':
            state.isPlaying = false;
            state.currentIndex = 0;
            state.currentTime = 0;
            break;
        case 'next':
            state.currentIndex = (state.currentIndex + 1) % playlist.length;
            state.currentTime = 0;
            state.isPlaying = true;
            break;
        case 'prev':
            state.currentIndex = (state.currentIndex - 1 + playlist.length) % playlist.length;
            state.currentTime = 0;
            state.isPlaying = true;
            break;
        case 'seek':
            if (time !== undefined) state.currentTime = time;
            break;
        default:
            return res.status(400).json({ error: 'Invalid action' });
    }
    await state.save();
    const currentSong = playlist[state.currentIndex];
    res.json({ success: true, state, currentSong });
});

// ---------- MUSIC: DELETE ----------
app.delete('/api/admin/music/:id', authMiddleware, async (req, res) => {
    if (req.user.email !== 'mdabusaifansari96@gmail.com') {
        return res.status(403).json({ error: 'Admin only' });
    }
    const song = await Music.findById(req.params.id);
    if (!song) return res.status(404).json({ error: 'Song not found' });
    try { fs.unlinkSync('./' + song.filepath); } catch (e) {}
    await song.deleteOne();
    res.json({ success: true, message: 'Song deleted' });
});

// ---------- SETTINGS ----------
app.get('/api/settings', async (req, res) => {
    try {
        if (!isMongoConnected) {
            return res.json({
                heroTitle: 'Free Indian +91 Checker',
                heroSubtitle: 'Get Name, Address, Circle & more for any 10-digit Indian number or Aadhaar.',
                heroDescription: 'Verify mobile number or Aadhaar instantly.',
                pricingHeading: '💰 Choose Your Pack',
                pricingDescription: 'Pay via UPI — amount auto-filled. Credits add after admin approval.',
                footerText: '© 2026 SAIF X INFO — Made in India 🇮🇳 for Indian numbers.'
            });
        }
        const settings = await Settings.getSettings();
        res.json(settings);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/admin/settings', authMiddleware, async (req, res) => {
    if (req.user.email !== 'mdabusaifansari96@gmail.com') {
        return res.status(403).json({ error: 'Admin only' });
    }
    if (!isMongoConnected) {
        return res.status(503).json({ error: 'Database unavailable. Try again later.' });
    }
    try {
        const settings = await Settings.getSettings();
        const updates = req.body;
        const allowed = ['heroTitle', 'heroSubtitle', 'heroDescription', 'pricingHeading', 'pricingDescription', 'footerText'];
        allowed.forEach(field => {
            if (updates[field] !== undefined) settings[field] = updates[field];
        });
        settings.updatedAt = new Date();
        await settings.save();

        await sendTelegramMessage(`✏️ <b>Website text updated</b>\nby ${req.user.email}`);
        res.json({ success: true, settings });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ---------- FALLBACK ----------
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ---------- START ----------
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
    if (isMongoConnected) {
        Settings.getSettings().then(() => console.log('✅ Settings initialized'));
    } else {
        console.log('⚠️ Running without database. Some features disabled.');
    }
});
