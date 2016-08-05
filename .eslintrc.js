module.exports = {
	"env": {
		"es6": true,
		"node": true
	},
	"extends": "eslint:recommended",
	"parserOptions": {
		"sourceType": "module"
	},
	"rules": {
		"indent": [
			"error",
			"tab", {
				"SwitchCase": 1
			}
		],
		"linebreak-style": [
			2,
			"unix"
		],
		"quotes": [
			2,
			"double"
		],
		"semi": [
			2,
			"always"
		],
		"no-case-declarations": [0]
	}
};
