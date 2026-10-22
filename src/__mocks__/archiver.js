const { Readable } = require('stream');

function mockArchiver() {
  const archive = new Readable({
    read() {},
  });

  archive.append = function (source, data) {
    return this;
  };

  archive.finalize = function () {
    this.push(Buffer.from('mock zip data'));
    this.push(null);
  };

  return archive;
}

module.exports = mockArchiver;
