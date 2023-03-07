const mongoose = require('mongoose');
var slug = require('mongoose-slug-generator');
const Schema = mongoose.Schema;

mongoose.plugin(slug);

const admin = new Schema({
    id_admin: { type: String },
    name_admin: { type: String },
    date_bth: { type: Date },
    email: { type: String },
    password: { type: String },
})

const user = new Schema({
    id_admin: { type: String },
    name_admin: { type: String },
    date_bth: { type: Date },
    email: { type: String },
    password: { type: String },
})

const Course = new Schema({
    name: { type: String },
    descripsion: { type: String, maxLength: 225 },
    image: { type: String, maxLength: 225 },
    videoId: { type: String, maxLength: 225 },
    slug: { type: String, slug: 'name', unique: true }
}, {
    timestamps: true
})

const lesson = new Schema({
    id_lesson: { type: String },
    name_lesson: { type: String },
    id_course: { type: String },
    descripsion: { type: String },
}, {
    timestamps: true
})

const question = new Schema({
    id_question: { type: String },
    id_lesson: { type: String },
    content: { type: String },
    answer_1: { type: String },
    answer_2: { type: String },
    answer_3: { type: String },
    answer_4: { type: String },
    correct_answer: { type: String },
    translate: { type: String },
})

const cmt = new Schema({
    id_cmt: { type: String },
    id_poster: { type: String },
    content: { type: String },
}, {
    timestamps: true
})


module.exports = mongoose.model('cmt', cmt)
module.exports = mongoose.model('Course', Course)

