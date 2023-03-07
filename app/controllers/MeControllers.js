const Course = require('../models/Course');
const { mongooseToOject, mutipleMongooseToOject } = require('../../util/mongoose');

class MeController {
  //get: /me/stored/courses
  storedCourses(req, res,next) {
    //cái trong find chính là điều kiện, ví dụ Course.find({name: 'hưng'}) tức là name là hưng thì nó mới trả về
    Course.find({})
      .then(courses => res.render('me/stored-courses', {
        courses: mutipleMongooseToOject(courses)
      }))
      .catch(next)
    
  }

}


module.exports = new MeController
