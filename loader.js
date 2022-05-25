const obfuscate = require('./obfuscate.js');

function loader(code) {
	const { salt } = this.getOptions();

	return obfuscate(code, salt).code;
}

module.exports = loader;
