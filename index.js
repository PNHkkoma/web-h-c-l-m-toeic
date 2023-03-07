const path = require('path');
const express = require('express');
const morgan = require('morgan');
const methodOverride = require('method-override');
const handlebars = require('express-handlebars');
const app = express(); //biến đại diện cho cái web, sẽ sử dụng cho đến khi web hoàn thành
const port = 3001 //chọn cổng

const route = require('./routes')
const db = require('./config/db')

db.connect()
app.use(express.static(path.join(__dirname, 'public')))

app.use(express.urlencoded({extended: true}))
app.use(express.json())

app.use(methodOverride('_method'))

// HTTP logger
app.use(morgan('combined'));
//template engine
app.engine('hbs', handlebars.engine({
  extname: '.hbs',
  helpers: {
    sum: (a,b) => a + b
  }
}));
app.set('view engine', 'hbs');
app.set('views',path.join(__dirname, 'resources','views'))
// cái dấu '/' định nghĩa tuyến đường rount, tức là phải gõ cái đó mới vào tới link cần xem

//router init
route(app)



//ctrl + S để lưu vào nodemon

//127.0.0.1 - localhost

app.listen(port, () => {
  console.log(`App listening on port ${port}`)
})