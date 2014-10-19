var expect = require('expect.js');
var derbyView = require('../lib');

describe('Serialize', function() {

  it('without errors', function(done) {
    derbyView(__dirname + '/test1/index.html', {minify: false}, function(err, res){
//      console.log(res);
      expect(err).equal(null);
      done();
    });
  });



});