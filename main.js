const { app, BrowserWindow, ipcMain, dialog, TouchBar } = require(
    'electron');
const dotenv = require('dotenv').config();
const nativeImage = require('electron').nativeImage;
const { autoUpdater } = require('electron-updater');
const log = require('electron-log');
const fs = require('fs');
const path = require('path');
const settings = require('electron-settings');
const svgo = require('svgo');
const execFile = require('child_process').execFile;
const mozjpeg = require('mozjpeg');
const pngquant = require('pngquant-bin');
const makeDir = require('make-dir');
const { TouchBarButton } = TouchBar;
const gifsicle = require('gifsicle');
const jimp = require("jimp");

global.debug = {
    devTools: 0
};

/**
 * Support for .env
 */
if(!dotenv.error){
    global.debug = {
        devTools: process.env.ELECTRON_DEBUG
    };
}

/**
 * Start logging in os log
 */
autoUpdater.logger = log;

autoUpdater.logger['transports'].file.level = 'info';
log.info('App starting...');

/**
 * Init vars
 */
let svg = new svgo();
let mainWindow;


/**
 * Create the browser window
 */
const createWindow = () => {

    /** Create the browser window. */
    mainWindow = new BrowserWindow({
        titleBarStyle: 'hiddenInset',
        width: 340,
        height: 550,
        minWidth: 340,
        minHeight: 550,
        frame: false,
        backgroundColor: '#F7F7F7',
        resizable: true,
        show: false,
        icon: path.join(__dirname, 'assets/icons/png/64x64.png'),
        webPreferences: {
            nodeIntegration: true
        }
    });

    /** Show window when ready */
    mainWindow.on('ready-to-show', () => {
        mainWindow.show();
    });

    /** Load index.html of the app. */
    mainWindow.loadURL(path.join('file://', __dirname, '/index.html')).then(
        () => {
            /** Open the DevTools. */
            global['debug'].devTools === 0 ||
            mainWindow.webContents.openDevTools();
        }
    ).catch(
        (error) => {
            log.error(error);
        }
    );

    /** Open the DevTools. */
    global['debug'].devTools === 0 || mainWindow.webContents.openDevTools();

    /** Window closed */
    mainWindow.on('closed', () => {
        mainWindow = null;
    });

    /** Default settings */
    const defaultSettings = {
        notification: true,
        folderswitch: true,
        clearlist: false,
        suffix: true,
        updatecheck: true,
        subfolder: false,
    };

    /** set missing settings */
    const newSettings = Object.assign({}, defaultSettings, settings.getAll());
    settings.setAll(newSettings);

    mainWindow.setTouchBar(touchBar);
    require('./menu/mainmenu');
};

/** Touchbar support */
let touchBarResult = new TouchBarButton({
    label: 'Let me shrink some images!',
    backgroundColor: '#000000',
    click: () => {
        dialog.showOpenDialog({
            properties: ['openFile', 'multiSelections']
        }).then(result => {
            if (result.canceled)
            {
                return;
            }
            for (let filePath of result.filePaths)
            {
                processFile(filePath, path.basename(filePath));
            }
        }).catch(err => {
            log.error(err);
        });
    }
});

let touchBarIcon = new TouchBarButton({
    backgroundColor: '#000000',
    'icon': nativeImage.createFromPath(path.join(__dirname, 'assets/icons/png/16x16.png')),
    iconPosition: 'center'
});

const touchBar = new TouchBar({
    items: [
        touchBarResult
    ]
});

/** Add Touchbar icon */
touchBar.escapeItem = touchBarIcon;

app.on('will-finish-launching', () => {
    app.on('open-file', (event, filePath) => {
        event.preventDefault();
        processFile(filePath, path.basename(filePath));
    });
});

/** Start app */
app.on('ready', () => {
    createWindow();
    if (settings.get('updatecheck') === true)
    {
        autoUpdater.checkForUpdatesAndNotify().catch((error) => {
            log.error(error);
        });
    }
});

/** Quit when all windows are closed. */
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin')
    {
        app.quit();
    }
});

app.on('activate', () => {
    if (mainWindow === null)
    {
        createWindow();
    }
});

/** When the update has been downloaded and is ready to be installed, notify the BrowserWindow */
autoUpdater.on('update-downloaded', (info) => {
    log.info(info);
    mainWindow.webContents.send('updateReady');
});

/** When receiving a quitAndInstall signal, quit and install the new version ;) */
ipcMain.on('quitAndInstall', (event, arg) => {
    log.info(event);
    log.info(arg);
    autoUpdater.quitAndInstall();
});

/** Main logic */
ipcMain.on(
    'shrinkImage', (event, fileName, filePath) => {
        processFile(filePath, fileName);
    }
);

/**
 * Shrinking the image
 * @param  {string} filePath Filepath
 * @param  {string} fileName Filename
 */
const processFile = (filePath, fileName) => {

    /** Focus window on drag */
    !mainWindow || mainWindow.focus();

    /** Change Touchbar */
    touchBarResult.label = 'I am shrinking for you';

    /** Get filesize */
    let sizeOrig = getFileSize(filePath, false);

    /** Process image(s) */
    fs.readFile(filePath, 'utf8', (err, data) => {

        if (err)
        {
            throw err;
        }

        app.addRecentDocument(filePath);
        const newFile = generateNewPath(filePath);

        switch (path.extname(fileName).toLowerCase())
        {
            case '.jpg':
            case '.jpeg':
            {
                /**  Create temp file from original, see #54 **/
                let origFile;
                let addTmpFile = !settings.get('suffix') && !settings.get('subfolder');

                if (addTmpFile) {
                    origFile = newFile + '.tmp';
                    fs.copyFileSync(filePath, origFile);
                }else {
                    origFile = filePath;
                }

                const watermarkMarginPercentage = 5;
                const watermarkFile = path.join(__dirname, 'assets/img/watermark.png')
                Promise.all([
                    jimp.read(origFile),
                    jimp.read(watermarkFile)
                ]).then(result => {
                    const [image, watermark] = result;
                    if (image.bitmap.height > image.bitmap.width) {
                        image.resize(320, jimp.AUTO);
                    } else {
                        image.resize(jimp.AUTO, 320);
                    }
                    
                    watermark.resize(image.bitmap.width, jimp.AUTO);
                    watermark.opacity(0.5);

                    const watermarkPlaceCount = Math.round(image.bitmap.height / watermark.bitmap.height);

                    return new Promise((resolve, reject) => {
                        try {
                            for (let i = 0; i < watermarkPlaceCount; i++) {
                                const X = 0;
                                const Y = image.bitmap.height - (watermarkPlaceCount * watermark.bitmap.height) + (watermark.bitmap.height * i)
                                image.composite(watermark, X, Y, [
                                    {
                                        mode: jimp.BLEND_DESTINATION_OVER,
                                        opacitySource: 1,
                                        opacityDest: 1
                                    }
                                ]).write(newFile);
                            }
                            resolve(image);
                        } catch(err) {
                            reject(err);
                        }

                        resolve(image);
                    });
                }).then(() => {
                    sendToRenderer(undefined, newFile, sizeOrig);
                }).catch(err => {
                    console.error(err);
                    sendToRenderer(err, newFile, sizeOrig);
                }).finally(() => {
                    /**  Delete tmp file **/
                    !addTmpFile || fs.unlinkSync(origFile);
                });
                break;
            }
            default:
                mainWindow.webContents.send('error');
                dialog.showMessageBoxSync({
                    'type': 'error',
                    'message': 'Only JPG allowed'
                });
        }
    });
};

/**
 * Generate new path to shrinked file
 * @param  {string} pathName Filepath
 * @return {object}         filepath object
 */
const generateNewPath = (pathName) => {

    let objPath = path.parse(pathName);

    if (settings.get('folderswitch') === false &&
        typeof settings.get('savepath') !== 'undefined')
    {
        objPath.dir = settings.get('savepath')[0];
    }

    if (settings.get('subfolder'))
    {
        objPath.dir = objPath.dir + '/with-watermark';
    }

    makeDir.sync(objPath.dir);

    /** Suffix setting */
    const suffix = settings.get('suffix') ? '.watermark' : '';
    objPath.base = objPath.name + suffix + objPath.ext;

    return path.format(objPath);
};

/**
 * Calculate filesize
 * @param  {string} filePath Filepath
 * @param  {boolean} mb     If true return as MB
 * @return {number}         filesize in MB or KB
 */
const getFileSize = (filePath, mb) => {
    const stats = fs.statSync(filePath);

    if (mb)
    {
        return stats.size / 1024;
    }

    return stats.size;
};

/**
 * Send data to renderer script
 * @param  {object} err      Error message
 * @param  {string} newFile  New filename
 * @param  {number}  sizeOrig Original filesize
 */
const sendToRenderer = (err, newFile, sizeOrig) => {

    if (!err)
    {
        let sizeShrinked = getFileSize(newFile, false);

        mainWindow.webContents.send(
            'isShrinked',
            newFile,
            sizeOrig,
            sizeShrinked
        );
    } else
    {
        log.error(err);
        mainWindow.webContents.send('error');
        dialog.showMessageBoxSync({
            'type': 'error',
            'message': 'I\'m not able to write your new image. Sorry! Error: ' + err
        });
    }
};
