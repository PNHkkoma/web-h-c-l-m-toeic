var express = require('express')
var router = express.Router()

const meController = require('../app/controllers/MeControllers')

//NewsController.index
router.get('/stored/courses', meController.storedCourses)

module.exports = router