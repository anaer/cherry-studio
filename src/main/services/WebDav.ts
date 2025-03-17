import { proxyManager } from '@main/services/ProxyManager'
import { WebDavConfig } from '@types'
import Logger from 'electron-log'
import { HttpProxyAgent } from 'http-proxy-agent'
import Stream from 'stream'
import {
  BufferLike,
  createClient,
  GetFileContentsOptions,
  PutFileContentsOptions,
  WebDAVClient,
  FileStat
} from 'webdav'
export default class WebDav {
  public instance: WebDAVClient | undefined
  private webdavPath: string

  constructor(params: WebDavConfig) {
    this.webdavPath = params.webdavPath
    const url = proxyManager.getProxyUrl()

    this.instance = createClient(params.webdavHost, {
      username: params.webdavUser,
      password: params.webdavPass,
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      httpAgent: url ? new HttpProxyAgent(url) : undefined,
      httpsAgent: proxyManager.getProxyAgent()
    })

    this.putFileContents = this.putFileContents.bind(this)
    this.getFileContents = this.getFileContents.bind(this)
  }

  public putFileContents = async (
    filename: string,
    data: string | BufferLike | Stream.Readable,
    options?: PutFileContentsOptions
  ) => {
    if (!this.instance) {
      return new Error('WebDAV client not initialized')
    }

    try {
      if (!(await this.instance.exists(this.webdavPath))) {
        await this.instance.createDirectory(this.webdavPath, {
          recursive: true
        })
      }
    } catch (error) {
      Logger.error('[WebDAV] Error creating directory on WebDAV:', error)
      throw error
    }

    const remoteFilePath = `${this.webdavPath}/${filename}`

    if (await this.instance.exists(remoteFilePath)) {
      const timestamp = new Date(new Date().getTime() + 8 * 60 * 60 * 1000)
        .toISOString()
        .replace(/[-:T.]/g, '')
        .slice(0, 14)
      const newRemoteFilePath = `${remoteFilePath}.${timestamp}`
      await this.instance.moveFile(remoteFilePath, newRemoteFilePath)
      Logger.info(`[WebDAV] Renamed existing file to ${newRemoteFilePath}`)
    }

    try {
      const files = await this.instance.getDirectoryContents(this.webdavPath)
      const backupFiles = (files as FileStat[])
        .filter((file) => file.type === 'file' && file.basename.startsWith(filename))
        .sort((a, b) => (a.lastmod && b.lastmod ? new Date(a.lastmod).getTime() - new Date(b.lastmod).getTime() : 0))

      if (backupFiles.length > 10) {
        const filesToDelete = backupFiles.slice(0, backupFiles.length - 10)
        for (const file of filesToDelete) {
          await this.instance.deleteFile(file.filename)
          Logger.info(`[WebDAV] Deleted old backup file: ${file.filename}`)
        }
      }
    } catch (error) {
      Logger.error('[WebDAV] Error managing backup files on WebDAV:', error)
      throw error
    }

    try {
      return await this.instance.putFileContents(remoteFilePath, data, options)
    } catch (error) {
      Logger.error('[WebDAV] Error putting file contents on WebDAV:', error)
      throw error
    }
  }

  public getFileContents = async (filename: string, options?: GetFileContentsOptions) => {
    if (!this.instance) {
      throw new Error('WebDAV client not initialized')
    }

    const remoteFilePath = `${this.webdavPath}/${filename}`

    try {
      return await this.instance.getFileContents(remoteFilePath, options)
    } catch (error) {
      Logger.error('[WebDAV] Error getting file contents on WebDAV:', error)
      throw error
    }
  }
}
