const Course = require('../models/Course');
const { mutipleMongooseToOject } = require('../../util/mongoose');

class SiteController {
    /*async index(req, res) {
    try {
      const courses = await Course.find({});
      res.json(courses);
    } catch (error) {
      res.status(400).json({ error: 'Course not found' });
    }
    }*/

  index(req, res,next) { 
    Course.find({})
      .then(course => { 
        res.render('home', {
          course: mutipleMongooseToOject(course)
        })
      })
      .catch(next)
  }
    search(req, res) {
        res.render('search')
    }
}


module.exports = new SiteController
