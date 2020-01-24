/**
 * FileNet Library
 * This library contains functions for downloading files from a FileNet server
 * oteng kwaku <otengkwaku@gmail.com>
 * 
 */
const soap = require('soap');
const fileNetURL = 'http://<filenet url>/wsi/FNCEWS40SOAP/wsdl';
var xml = require('xml2js');


/**
 * @description This function returns the meta data of a file which inlcude the files classId, objectId, objectStore
 * @return array
 * * structure:
 * [
 *    {
 *       "classId": "SS1RegistrationForm",
 *       "objectId": "{D1616414-6A9E-461E-9476-A5303E5EF5A5}",
 *       "objectStore": "{F8135C1E-032E-47D4-A890-8CD0FC7D0508}"
 *     },
 *   ...
 * ]
 */
async function get_doc_meta(data) {
    fileNetConnect().then(soapClient => {
        // RegistrationDocuments
        search(soapClient, getSearchObj(`SELECT TOP 100 This, ${data.field} FROM ${data.table}  WHERE ${data.field} = '${data.value}' OPTIONS(TIMELIMIT 1000)`, '<Object Store>'))
            .then(r => {
                let rows = processSearchResult(r);
                return rows
            }).catch(e => {
            console.log(e);
        })
    }).catch(err => {
        console.log(err);
    });
}

/**
 * @description This is just a wrapper function that calls the actural download function
 * it creats a new connect for the download function to use. you can do away with this function
 * if you use these codes in a single file
 * @param row - a simple item returned from get_dow_meta()
 */
function download_doc(row) {
    fileNetConnect().then(soapClient => {
        downloadFile(soapClient, getDownloadQuery(row))
    });
}

/**
 * @description This connect creates a connection and return the connection object
 * for interacting with the FileNet Server
 * @return {Promise<*>}
 */
async function fileNetConnect() {
    let soapClient = await soap.createClientAsync(fileNetURL, {
        attributesKey: '$attributes',
        wsdl_headers: {
            connection: 'keep-alive'
        }
    });

    let wsSecurity = new soap.WSSecurity('<user name>', '<password>');
    soapClient.setSecurity(wsSecurity);
    return soapClient;
}

/**
 * @description Search for a particular file using a search query
 * @param soapClient - the connection object returned by fileNetConnect()
 * @param query - query object returned from getSearchObj()
 * @return {Promise<unknown>}
 */
function search(soapClient, query) {
    soapClient.addSoapHeader({
        'ctyp:Localization': {
            'ctyp:Locale': query.meta.locale
        }
    });
    return new Promise((resolve, reject) => {
        soapClient.ExecuteSearch(query.search, function (e, r) {
            if (e)
                return reject(e);
            return resolve(r);
        });
    })
}

/**
 * @description build a query object for search() to use
 * @param query - query string using FileNet SQL structure
 * @param objectStore
 * @param searchRows
 * @param maxElements
 * @param continuable
 * @return {{search: {SearchScope: {$attributes: {objectStore: *, "xsi:type": string}}, SearchSQL: *, $attributes: {continuable: (*|boolean), repositorySearchMode: (*|string), "xsi:type": string, maxElements: (*|number)}}, meta: {locale: string}}}
 */
function getSearchObj(query, objectStore, searchRows, maxElements, continuable) {
    if (!query || !objectStore)
        throw new TypeError('query and objectStore is required');

    return {
        meta: {
            locale: 'en-US'
        },
        search: {
            $attributes: {
                'xsi:type': 'RepositorySearch',
                repositorySearchMode: searchRows || 'Rows',
                maxElements: maxElements || 0,
                continuable: continuable || true
            },
            SearchScope: {
                $attributes: {
                    'xsi:type': 'ObjectStoreScope',
                    objectStore: objectStore
                }
            },
            SearchSQL: query
        }
    };
}

/**
 * @description process the result returned from search()
 * @param result - returned from search()
 * @return {[]}
 */
function processSearchResult(result) {
    let rows = [];
    let item;
    if (result instanceof Array) {
        item = result;
    } else item = result.Object;

    for (let i = 0; i < item.length; i++) {
        let obj = item[i];
        obj.Property.forEach(item => {
            if (item['$attributes'].propertyId === 'This')
                rows.push(
                    {
                        classId: item.Value['$attributes'].classId,
                        objectId: item.Value['$attributes'].objectId,
                        objectStore: item.Value['$attributes'].objectStore,
                    }
                )
        })
    }
    return rows;
}

/**
 * @description takes a single object from processSearchResult() returned array and download that file
 * @param soapClient
 * @param downloadQuery - download query object return by getDownloadQuery()
 * @return Object
 *  {
 *     fileName: <file name>,
 *     data: <base64 encoding of the file>
 *     ext: the extension of the file
 * }
 *
 */
function downloadFile(soapClient, downloadQuery) {
    function fileHandler(body, responds) {
        let parser = new xml.Parser();
        parser.parseStringPromise(responds.body).then(function (result) {
            let item = result['e:Envelope']['e:Body']['0']['GetContentResponse']['0']['ContentResponse'];
            let tmp = item['0']['$']['retrievalName'];
            return {
                fileName: tmp,
                data: getFileType((tmp.split('.'))[tmp.split('.').length - 1]) + item['0']['Content']['0']['Binary']['0'],
                ext: (tmp.split('.'))[tmp.split('.').length - 1]
            }
        }).catch(e => {
            console.log(e);
        })
    }

    soapClient.on('response', fileHandler);
    soapClient.GetContent(downloadQuery, function (e, r) {
    });
}

/**
 * @description build a query object for downloadFile() use
 * @param row - one object from processSearchResult()
 * @param itemIndex
 * @param continuable
 * @param validateOnly
 * @param cacheAllowed
 * @return {{ContentRequest: {SourceSpecification: {$attributes: {classId: *, objectStore: *, objectId: *}}, ElementSpecification: {$attributes: {itemIndex: (*|number)}}, $attributes: {continuable: (*|boolean), id: string, maxBytes: number, cacheAllowed: (*|boolean)}}, $attributes: {validateOnly: (*|boolean)}}}
 */
function getDownloadQuery(row, itemIndex, continuable, validateOnly, cacheAllowed) {
    return {
        $attributes: {
            validateOnly: validateOnly || false
        },
        ContentRequest: {
            $attributes: {
                id: '1',
                cacheAllowed: cacheAllowed || false,
                maxBytes: 1000000,
                continuable: continuable || false
            },
            SourceSpecification: {
                $attributes: {
                    classId: row.classId,
                    objectId: row.objectId,
                    objectStore: row.objectStore
                }
            },
            ElementSpecification: {
                $attributes: {
                    itemIndex: itemIndex || 0
                }
            }
        }
    };
}

// this is just a utility function
function getFileType(extention) {
    let tmp = {
        'pdf': 'data:application/pdf;base64,',
        'png': 'data:application/png;base64,',
        'jpeg': 'data:application/jpeg;base64,',
        'jpg': 'data:application/jpeg;base64,',
    };
    return tmp[extention]
}
