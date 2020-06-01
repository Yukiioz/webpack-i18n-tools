const fs = require('fs');
const glob = require('glob');
const JSON5 = require('json5');

const PREFIX_BUILD = /.*exports=/g;
const SUFFIX_BUILD = /}}]\);\s.*/g;

const PREFIX_SERVE = /[\w\W]+exports = /g;
const SUFFIX_SERVE = /\n{2}\/\*{3}\/ }\)[\W\w]+/g;

class PoLoaderOptimizer {

    constructor() {
        this.compiler = null;
        this.originalPoFile = null;
        this.poFiles = [];
        this.assetEmittedSupported = false;
    }

    parseFile(content) {
        const stringContent = content.toString();

        let prefix = '', suffix = '';
        if (!stringContent.match(PREFIX_BUILD)) {
            prefix = PREFIX_SERVE;
            suffix = SUFFIX_SERVE;
        } else {
            prefix = PREFIX_BUILD;
            suffix = SUFFIX_BUILD;
        }

        return {
            prefix: stringContent.match(prefix)[0],
            suffix: stringContent.match(suffix)[0],
            content: JSON5.parse(
                stringContent
                    .replace(prefix, '')
                    .replace(suffix, '')
                    .replace(/(^{|",)(\w+):/g, '$1"$2":')
            ),
        };
    }

    done(statsData, cb) {
        this.root = this.compiler.options.context;

        if (!this.assetEmittedSupported) {
            const files = glob.sync('./dist/**/*.js');
            files.forEach(filepath => {
                this.assetEmitted(filepath.replace(/.*dist\//g, ''), fs.readFileSync(filepath));
            });
        }

        // if there's webpack / plugin errors
        if (statsData.hasErrors()) {
            cb();
            return;
        }

        // if it's not a BUILD but a SERVE (so no dist folder) then no i18n optimization applied
        if (!fs.existsSync('./dist/')) {
            cb();
            return;
        }

        // replace long string keys by numbers in po objects
        (() => {
            const tmp = {};
            Object.values(this.originalPoFile.content).map((value, i) => {
                tmp[i] = value;
            });
            this.originalPoFile.content = tmp;
        })();

        this.poFiles.forEach(poFile => {
            const tmp = {};

            Object.values(this.originalPoFile.content).forEach((value, i) => {
                tmp[i] = poFile.content[value] || value;
            });

            poFile.content = tmp;
        });

        // replace the keys from the js files and save file
        const files = glob.sync('./dist/**/*.js');
        const entries = Object.entries(this.originalPoFile.content);

        let i = files.length;
        while (i--) {
            let content = fs.readFileSync(files[i], 'utf8');

            for (const [k, v] of entries) {
                const searchString = v.replace(/\n/g, '\\n') // Search actual newlines as \n escape sequences in code.
                    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // Escape regex special chars.
                const regex = new RegExp('(?:' // non capturing group
                    + '[$.]t[ec]?\\(\\s*' // search for $t / $tc / $te calls
                    + '|' // or
                    + 'i18n.*?attrs:.*?path:\\s*' // for i18n interpolation components' paths
                    + ')' // end non-capturing group
                    + `["'\`](${searchString})["'\`]`, // for the language string
                    'g');
                content = content.replace(regex, (match, searchString) => {
                    const searchStringPosition = match.indexOf(searchString);
                    // replace by number without enclosing string delimiters
                    return match.substring(0, searchStringPosition - 1)
                        + k
                        + match.substring(searchStringPosition + searchString.length + 1);
                });
            }

            fs.writeFileSync(files[i], content);
        }

        // save po files
        fs.writeFileSync(
            "./dist/" + this.originalPoFile.filename,
            this.originalPoFile.prefix + JSON.stringify(this.originalPoFile.content) + this.originalPoFile.suffix
        );

        this.poFiles.forEach(poFile => {
            fs.writeFileSync(
                "./dist/" + poFile.filename,
                poFile.prefix + JSON.stringify(poFile.content) + poFile.suffix
            )
        });

        cb();
    }

    assetEmitted(file, content, cb) {
        if (/.*en-po.*\.js$/g.test(file)) {
            this.originalPoFile = {
                filename: file,
                ...this.parseFile(content)
            };
        } else if (/.*-po.*\.js$/g.test(file)) {
            this.poFiles.push({
                filename: file,
                ...this.parseFile(content)
            });
        }
        if (cb) {
            cb();
        }
    }

	apply(compiler) {
        this.compiler = compiler;

        if (compiler.hooks.assetEmitted) {
            this.assetEmittedSupported = true;
            compiler.hooks.assetEmitted.tapAsync('PoLoaderOptimizer', this.assetEmitted.bind(this));
        }
        compiler.hooks.done.tapAsync('PoLoaderOptimizer', this.done.bind(this));
	}
}

module.exports = PoLoaderOptimizer;
