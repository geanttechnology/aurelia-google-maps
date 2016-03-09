import {inject} from 'aurelia-dependency-injection';
import {bindable, customElement} from 'aurelia-templating';
import {TaskQueue} from 'aurelia-task-queue';
import {BindingEngine} from 'aurelia-framework';

import {Configure} from './configure';

@customElement('google-map')
@inject(Element, TaskQueue, Configure, BindingEngine)
export class GoogleMaps {
    @bindable address = null;
    @bindable longitude = 0;
    @bindable latitude = 0;
    @bindable zoom = 8;
    @bindable disableDefaultUI = false;
    @bindable markers = [];

    map = null;
    _renderedMarkers = [];
    _scriptPromise = null;
    _markersSubscription = null;

    constructor(element, taskQueue, config, bindingEngine) {
        this.element = element;
        this.taskQueue = taskQueue;
        this.config = config;
        this.bindingEngine = bindingEngine;

        if (!config.get('apiScript')) {
            console.error('No API script is defined.');
        }

        if (!config.get('apiKey')) {
            console.error('No API key has been specified.');
        }

        this.loadApiScript();
    }

    attached() {
        this.element.addEventListener('dragstart', evt => {
            evt.preventDefault();
        });

        this._scriptPromise.then(() => {
            let latLng = new google.maps.LatLng(parseFloat(this.latitude), parseFloat(this.longitude));

            let options = {
                center: latLng,
                zoom: parseInt(this.zoom, 10),
                disableDefaultUI: this.disableDefaultUI
            };

            this.map = new google.maps.Map(this.element, options);

            // Add event listener for click event
            this.map.addListener('click', (e) => {
                let changeEvent;
                if (window.CustomEvent) {
                    changeEvent = new CustomEvent('map-click', {
                        detail: e,
                        bubbles: true
                    });
                } else {
                    changeEvent = document.createEvent('CustomEvent');
                    changeEvent.initCustomEvent('map-click', true, true, { data: e });
                }

                this.element.dispatchEvent(changeEvent);
            });
        });
    }

    /**
     * Render a marker on the map and add it to collection of rendered markers
     *
     * @param latitude
     * @param longitude
     *
     */
    renderMarker(latitude, longitude) {
        let markerLatLng = new google.maps.LatLng(parseFloat(latitude), parseFloat(longitude));

        this._scriptPromise.then(() => {
            // Create the marker
            this.createMarker({
                map: this.map,
                position: markerLatLng
            }).then(marker => {
                // Add it the array of rendered markers
                this._renderedMarkers.push(marker);
            });
        });
    }

    /**
     * Geocodes an address, once the Google Map script
     * has been properly loaded and promise instantiated.
     *
     * @param address string
     * @param geocoder any
     *
     */
    geocodeAddress(address, geocoder) {
        this._scriptPromise.then(() => {
            geocoder.geocode({'address': address}, (results, status) => {
                if (status === google.maps.GeocoderStatus.OK) {
                    this.setCenter(results[0].geometry.location);

                    this.createMarker({
                        map: this.map,
                        position: results[0].geometry.location
                    });
                }
            });
        });
    }

    /**
     * Get Current Position
     *
     * Get the users current coordinate info from their browser
     *
     */
    getCurrentPosition() {
        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(position => Promise.resolve(position), evt => Promise.reject(evt));
        } else {
            return Promise.reject('Browser Geolocation not supported or found.');
        }
    }

    /**
     * Load API Script
     *
     * Loads the Google Maps Javascript and then resolves a promise
     * if loaded. If Google Maps is already loaded, we just return
     * an immediately resolved promise.
     *
     * @return Promise
     *
     */
    loadApiScript() {
        if (this._scriptPromise) {
            return this._scriptPromise;
        }

        if (window.google === undefined || window.google.maps === undefined) {
            let script = document.createElement('script');

            script.type = 'text/javascript';
            script.async = true;
            script.defer = true;
            script.src = `${this.config.get('apiScript')}?key=${this.config.get('apiKey')}&callback=myGoogleMapsCallback`;
            document.body.appendChild(script);

            this._scriptPromise = new Promise((resolve, reject) => {
                window.myGoogleMapsCallback = () => {
                    resolve();
                };

                script.onerror = error => {
                    reject(error);
                };
            });

            return this._scriptPromise;
        }
    }

    setOptions(options) {
        if (!this.map) {
            return;
        }

        this.map.setOptions(options);
    }

    createMarker(options) {
        return this._scriptPromise.then(() => {
            return Promise.resolve(new google.maps.Marker(options));
        });
    }

    getCenter() {
        this._scriptPromise.then(() => {
            return Promise.resolve(this.map.getCenter());
        });
    }

    setCenter(latLong) {
        this._scriptPromise.then(() => {
            this.map.setCenter(latLong);
        });
    }

    updateCenter() {
        this._scriptPromise.then(() => {
            let latLng = new google.maps.LatLng(parseFloat(this.latitude), parseFloat(this.longitude));
            this.setCenter(latLng);
        });
    }

    addressChanged(newValue) {
        this._scriptPromise.then(() => {
            let geocoder = new google.maps.Geocoder;

            this.taskQueue.queueMicroTask(() => {
                this.geocodeAddress(newValue, geocoder);
            });
        });
    }

    latitudeChanged(newValue) {
        this._scriptPromise.then(() => {
            this.taskQueue.queueMicroTask(() => {
                this.updateCenter();
            });
        });
    }

    longitudeChanged(newValue) {
        this._scriptPromise.then(() => {
            this.taskQueue.queueMicroTask(() => {
                this.updateCenter();
            });
        });
    }

    zoomChanged(newValue) {
        this._scriptPromise.then(() => {
            this.taskQueue.queueMicroTask(() => {
                let zoomValue = parseInt(newValue, 10);
                this.map.setZoom(zoomValue);
            });
        });
    }

    /**
     * Observing changes in the entire markers object. This is critical in case the user sets marker to a new empty Array,
     * where we need to resubscribe Observers and delete all previously rendered markers.
     *
     * @param newValue
     */
    markersChanged(newValue) {
        // If there was a previous subscription
        if (this._markersSubscription !== null) {
            // Dispose of the subscription
            this._markersSubscription.dispose();

            // Remove all the currently rendered markers
            for (let marker of this._renderedMarkers) {
                marker.setMap(null);
            }

            // And empty the renderMarkers collection
            this._renderedMarkers = [];
        }

        // Add the subcription to markers
        this._markersSubscription = this.bindingEngine
            .collectionObserver(this.markers)
            .subscribe((splices) => { this.markerCollectionChange(splices); });

        // Render all markers again
        this._scriptPromise.then(() => {
            for (let marker of newValue) {
                this.renderMarker(marker.latitude, marker.longitude);
            }
        });
    }

    /**
     * Handle the change to the marker collection. Collection observer returns an array of splices which contains
     * information about the change to the collection.
     *
     * @param splices
     */
    markerCollectionChange(splices) {
        for (let splice of splices) {
            if (splice.removed.length) {
                // Iterate over all the removed markers
                for (let removedObj of splice.removed) {
                    // Iterate over all the rendered markers to find the one to remove
                    for (let markerIndex in this._renderedMarkers) {
                        if (this._renderedMarkers.hasOwnProperty(markerIndex)) {
                            let renderedMarker = this._renderedMarkers[markerIndex];

                            // Check if the latitude/longitude matches
                            if (renderedMarker.position.lat() === removedObj.latitude &&
                                renderedMarker.position.lng() === removedObj.longitude) {
                                // Set the map to null;
                                renderedMarker.setMap(null);

                                // Splice out this rendered marker as well
                                this._renderedMarkers.splice(markerIndex, 1);
                                break;
                            }
                        }
                    }
                }
            }

            // Add the new markers to the map
            if (splice.addedCount) {
                let addedMarker = this.markers[splice.index];

                this.renderMarker(addedMarker.latitude, addedMarker.longitude);
            }
        }
    }

    error() {
        console.log.apply(console, arguments);
    }
}