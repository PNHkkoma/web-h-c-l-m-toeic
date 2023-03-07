var express = require('express')
var router = express.Router()

const newsController = require('../app/controllers/NewsControllers')

//NewsController.index

router.get('/:slug', newsController.index)
router.get('/', newsController.index)

module.exports = router