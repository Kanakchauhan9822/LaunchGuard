const { spawn } = require("node:child_process")

function runScanner(name, config, args, directory, signal) {
  signal?.throwIfAborted()

  return new Promise((resolve, reject) => {
    const renderLinux = process.env.RENDER === "true" && process.platform === "linux"
    const executable = renderLinux ? "/usr/bin/nice" : config.executable
    const scannerArgs = renderLinux ? ["-n", "10", config.executable, ...args] : args
    const child = spawn(executable, scannerArgs, {
      cwd: directory,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: scannerEnvironment(directory)
    })

    const chunks = []
    let outputBytes = 0
    let stderrBytes = 0
    let failure

    function stop(message) {
      if (!failure) {
        failure = scannerError(message)
      }

      child.kill("SIGKILL")
    }

    function collectOutput(chunk, isError) {
      outputBytes += chunk.length

      if (isError) {
        stderrBytes += chunk.length
      }

      if (outputBytes > config.maxOutputBytes) {
        stop(`${name} exceeded its output-size limit`)
        return
      }

      if (!isError && !failure) {
        chunks.push(chunk)
      }
    }

    const timer = setTimeout(() => {
      stop(`${name} exceeded its execution-time limit`)
    }, config.timeoutMs)
    const abort = () => stop(`${name} was cancelled`)
    signal?.addEventListener("abort", abort, { once: true })

    if (signal?.aborted) {
      abort()
    }

    child.stdout.on("data", chunk => collectOutput(chunk, false))
    child.stderr.on("data", chunk => collectOutput(chunk, true))

    child.on("error", () => {
      if (!failure) {
        failure = scannerError(`${name} could not start or encountered a process error. Check its executable configuration.`)
      }
    })

    child.on("close", (exitCode, terminationSignal) => {
      clearTimeout(timer)
      signal?.removeEventListener("abort", abort)

      if (failure || terminationSignal) {
        reject(failure || scannerError(`${name} was terminated before completing`))
        return
      }

      resolve({
        exitCode,
        stderrBytes,
        output: Buffer.concat(chunks).toString("utf8")
      })
    })
  })
}

function scannerEnvironment(directory) {
  const env = {
    HOME: directory,
    USERPROFILE: directory,
    TMPDIR: directory,
    TEMP: directory,
    TMP: directory,
    GOMAXPROCS: "2"
  }

  if (process.env.RENDER === "true") {
    env.GOMAXPROCS = "1"
    env.GOMEMLIMIT = "112MiB"
    env.NODE_OPTIONS = "--max-old-space-size=128"
  }

  for (const name of ["PATH", "Path", "SystemRoot", "SYSTEMROOT", "WINDIR", "PATHEXT"]) {
    if (process.env[name]) {
      env[name] = process.env[name]
    }
  }

  return env
}

function scanResult(tool, status, findings, reason, startedAt) {
  return {
    findings,
    outcome: {
      tool,
      status,
      findingCount: findings.length,
      reason,
      startedAt,
      finishedAt: new Date()
    }
  }
}

function scannerError(message) {
  return Object.assign(new Error(message), {
    scannerFailure: message
  })
}

module.exports = {
  runScanner,
  scanResult,
  scannerError
}
