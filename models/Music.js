const mongoose = require('mongoose');

const MusicSchema = new mongoose.Schema({
    title: { type: String, required: true },
    filename: { type: String, required: true },
    filepath: { type: String, required: true },
    duration: { type: Number, default: 0 },
    uploadedBy: { type: String, default: 'admin' },
    createdAt: { type: Date, default: Date.now }
});

const PlaylistStateSchema = new mongoose.Schema({
    isPlaying: { type: Boolean, default: false },
    currentIndex: { type: Number, default: 0 },
    currentTime: { type: Number, default: 0 },
    updatedAt: { type: Date, default: Date.now }
});

module.exports = {
    Music: mongoose.model('Music', MusicSchema),
    PlaylistState: mongoose.model('PlaylistState', PlaylistStateSchema)
};
