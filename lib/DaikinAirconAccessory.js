module.exports = (exportedTypes) => {
  const { Service, Characteristic, Requester } = exportedTypes;
  return class DaikinAirconAccessory {
    constructor(log, config = {}) {
      /* eslint-disable no-console */
      this.log = log || console.log;
      /* eslint-enable no-console */
      this.host = config.host || 'http://localhost';
      this.name = config.name || 'test';
      
      this.targetHeaterCoolerState = Characteristic.TargetHeatingCoolingState.OFF;
    }

    /**
       * アダプタからのレスポンスをオブジェクトに変換する
       * @param {string} response - HTTPのレスポンスボディ
       * @return {object}
       */
    static parseResponse(response) {
      const vals = {};
      if (response) {
        const items = response.split(',');
        const { length } = items;
        for (let i = 0; i < length; i += 1) {
          const [key, value] = items[i].split('=');
          vals[key] = value;
        }
      }
      return vals;
    }

    /**
       * 現在のエアコンの状態を返す
       * @param {function} callback - コールバック
       */
    getHeaterCoolerState(callback) {
      const requester = new Requester(this.host);
      requester.get('/aircon/get_control_info', (body) => {
        const responseValues = DaikinAirconAccessory.parseResponse(body);
        let status = Characteristic.CurrentHeatingCoolingState.OFF;
        let logString = 'DaikinAirconAccessory got heater cooler state ';
        if (responseValues.pow === '1') {
          switch (responseValues.mode) {
            case '3':
              status = Characteristic.CurrentHeatingCoolingState.COOL;
              this.targetHeaterCoolerState = Characteristic.TargetHeatingCoolingState.COOL;
              logString += 'COOL';
              break;
            case '4':
              status = Characteristic.CurrentHeatingCoolingState.HEAT;
              this.targetHeaterCoolerState = Characteristic.TargetHeatingCoolingState.HEAT;
              logString += 'HEAT';
              break;
            default:
              status = Characteristic.CurrentHeatingCoolingState.AUTO;
              this.targetHeaterCoolerState = Characteristic.TargetHeatingCoolingState.AUTO;
              logString += 'AUTO';
              break;
          }
        } else {
          this.targetHeaterCoolerState = Characteristic.TargetHeatingCoolingState.OFF;
          logString += 'OFF';
        }
        this.log(logString);
        callback(null, status);
      });
    }

    /**
     * 運転モードを返す
       * @param {function} callback - コールバック
     */
    getTargetHeaterCoolerState(callback) {
      callback(null, this.targetHeaterCoolerState);
    }

    /**
       * 運転モードを設定する
       * @param {number} callback - 設定する運転モード
       * @param {function} callback - コールバック
       */
    setTargetHeaterCoolerState(state, callback) {
      this.targetHeaterCoolerState = state;
      
      // 現在の設定内容を取得し、モード(mode)のみ変更して設定リクエストを投げる。
      const requester = new Requester(this.host);
      requester.get('/aircon/get_control_info', (body) => {
        const currentValues = DaikinAirconAccessory.parseResponse(body);
        let query = body;
        
        if (state === Characteristic.TargetHeatingCoolingState.OFF) {
          query = body
            .replace(/,/g, '&')
            .replace(/pow=[01]/, 'pow=0');
        } else {
          let mode = currentValues;

          switch (state) {
            case Characteristic.TargetHeatingCoolingState.AUTO:
              mode = 1;
              break;
            case Characteristic.TargetHeatingCoolingState.COOL:
              mode = 3;
              break;
            case Characteristic.TargetHeatingCoolingState.HEAT:
              mode = 4;
              break;
            default:
              break;
          }
          
          query = body
            .replace(/,/g, '&')
            .replace(/pow=[01]/, 'pow=1')
            .replace(/mode=[^&]+/, `mode=${mode}`);
        }
        
        requester.get(`/aircon/set_control_info?${query}`, (response) => {
          const responseValues = DaikinAirconAccessory.parseResponse(response);
          const result = responseValues.ret === 'OK' ? undefined : new Error(responseValues.ret);
          callback(result);
        }, false);
      });
    }

    /**
       * 現在の室温
       * @param {function} callback - コールバック
       */
    getCurrentTemperature(callback) {
      const requester = new Requester(this.host);
      requester.get('/aircon/get_sensor_info', (body) => {
        const responseValues = DaikinAirconAccessory.parseResponse(body);
        const htemp = parseFloat(responseValues.htemp);
        this.log(`DaikinAirconAccessory got current temperature ${htemp}`);
        callback(null, parseFloat(responseValues.htemp));
      });
    }

    /**
       * 冷暖房の設定温度を取得する
       * @param {function} callback - コールバック
       */
    getTargetTemperature(callback) {
      const requester = new Requester(this.host);
      requester.get('/aircon/get_control_info', (body) => {
        const responseValues = DaikinAirconAccessory.parseResponse(body);
        if (responseValues.stemp && /^[0-9.]+$/.test(responseValues.stemp)) {
          this.log(`DaikinAirconAccessory got target temperature ${responseValues.stemp}`);
          callback(null, parseFloat(responseValues.stemp));
        } else {
          this.log('DaikinAirconAccessory could not get target temperature');
          this.log(responseValues);
          callback(null, 0);
        }
      });
    }

    /**
       * 冷房の温度を設定する
       * @param {float} temp - 設定する冷房温度
       * @param {function} callback - コールバック
       */
    setTargetTemperature(temp, callback) {
      // 現在の設定内容を取得し、モード(mode)のみ変更して設定リクエストを投げる。
      const requester = new Requester(this.host);
      requester.get('/aircon/get_control_info', (body) => {
        const query = body
          .replace(/,/g, '&')
          .replace(/stemp=[0-9.]+/, `stemp=${temp}`)
        requester.get(`/aircon/set_control_info?${query}`, (response) => {
          const responseValues = DaikinAirconAccessory.parseResponse(response);
          const result = responseValues.ret === 'OK' ? undefined : new Error(responseValues.ret);
          callback(result);
        }, false);
      });
    }

    /**
       * サービスの設定
       */
    getServices() {
      const heaterCoolerService = new Service.Thermostat(this.name);

      heaterCoolerService
        .getCharacteristic(Characteristic.CurrentHeatingCoolingState)
        .on('get', this.getHeaterCoolerState.bind(this));

      heaterCoolerService
        .getCharacteristic(Characteristic.TargetHeatingCoolingState)
        .on('get', this.getTargetHeaterCoolerState.bind(this))
        .on('set', this.setTargetHeaterCoolerState.bind(this));

      heaterCoolerService
        .getCharacteristic(Characteristic.CurrentTemperature)
        .on('get', this.getCurrentTemperature.bind(this));
        
      heaterCoolerService
        .getCharacteristic(Characteristic.TargetTemperature)
        .on('get', this.getTargetTemperature.bind(this))
        .on('set', this.setTargetTemperature.bind(this));

      return [heaterCoolerService];
    }
  };
};
