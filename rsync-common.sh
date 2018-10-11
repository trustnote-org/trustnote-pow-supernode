rm -rf ./node_modules/trustnote-pow-common/
mkdir -p ./node_modules/trustnote-pow-common/ 
rsync -rv --exclude=.git --exclude=node_modules --exclude=.idea ../trustnote-pow-common/ ./node_modules/trustnote-pow-common/
echo done!
