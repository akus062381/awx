export default ['$stateParams', '$scope', '$state', 'QuerySet', 'GetBasePath', 'QuerySet', 'SmartSearchService',
    function($stateParams, $scope, $state, QuerySet, GetBasePath, qs, SmartSearchService) {

        let path, relations,
            // steps through the current tree of $state configurations, grabs default search params
            defaults = _.find($state.$current.path, (step) => {
                return step.params.hasOwnProperty(`${$scope.iterator}_search`);
            }).params[`${$scope.iterator}_search`].config.value,
            queryset = $stateParams[`${$scope.iterator}_search`];

        // build $scope.tags from $stateParams.QuerySet, build fieldset key
        init();

        function init() {
            path = GetBasePath($scope.basePath) || $scope.basePath;
            relations = getRelationshipFields($scope.dataset.results);
            $scope.searchTags = stripDefaultParams($state.params[`${$scope.iterator}_search`]);
            qs.initFieldset(path, $scope.djangoModel, relations).then((data) => {
                $scope.models = data.models;
                $scope.options = data.options.data;
                $scope.$emit(`${$scope.list.iterator}_options`, data.options);
            });
        }

        // Removes state definition defaults and pagination terms
        function stripDefaultParams(params) {
            let stripped =_.pick(params, (value, key) => {
                // setting the default value of a term to null in a state definition is a very explicit way to ensure it will NEVER generate a search tag, even with a non-default value
                return defaults[key] !== value && key !== 'order_by' && key !== 'page' && key !== 'page_size' && defaults[key] !== null;
            });
            return _(stripped).map(qs.decodeParam).flatten().value();
        }

        // searchable relationships
        function getRelationshipFields(dataset) {
            let flat = _(dataset).map((value) => {
                return _.keys(value.related);
            }).flatten().uniq().value();
            return flat;
        }

        function setDefaults(term) {
            if ($scope.list.defaultSearchParams) {
                return $scope.list.defaultSearchParams(term);
            } else {
               return {
                    search: encodeURIComponent(term)
                };
            }
        }

        $scope.toggleKeyPane = function() {
            $scope.showKeyPane = !$scope.showKeyPane;
        };

        $scope.clearAll = function(){
            let cleared = _.cloneDeep(defaults);
            delete cleared.page;
            queryset = cleared;
            $state.go('.', {[$scope.iterator + '_search']: queryset});
            qs.search(path, queryset).then((res) => {
                $scope.dataset = res.data;
                $scope.collection = res.data.results;
            });
            $scope.searchTags = stripDefaultParams(queryset);
        };

        // remove tag, merge new queryset, $state.go
        $scope.remove = function(index) {
            let tagToRemove = $scope.searchTags.splice(index, 1)[0];
            let termParts = SmartSearchService.splitTermIntoParts(tagToRemove);
            let removed;
            if (termParts.length === 1) {
                removed = setDefaults(tagToRemove);
            }
            else {
                let root = termParts[0].split(".")[0].replace(/^-/, '');
                let encodeParams = {
                    term: tagToRemove
                };
                if(_.has($scope.options.actions.GET, root)) {
                    if($scope.options.actions.GET[root].type && $scope.options.actions.GET[root].type === 'field') {
                        encodeParams.relatedSearchTerm = true;
                    }
                    else {
                        encodeParams.searchTerm = true;
                    }
                }
                removed = qs.encodeParam(encodeParams);
            }
            _.each(removed, (value, key) => {
                if (Array.isArray(queryset[key])){
                    _.remove(queryset[key], (item) => item === value);
                }
                else {
                    delete queryset[key];
                }
            });
            $state.go('.', {
                [$scope.iterator + '_search']: queryset });
            qs.search(path, queryset).then((res) => {
                $scope.dataset = res.data;
                $scope.collection = res.data.results;
            });
            $scope.searchTags = stripDefaultParams(queryset);
        };

        // add a search tag, merge new queryset, $state.go()
        $scope.add = function(terms) {
            let params = {},
                origQueryset = _.clone(queryset);

            // Remove leading/trailing whitespace if there is any
            terms = terms.trim();

            if(terms && terms !== '') {
                // Split the terms up
                let splitTerms = SmartSearchService.splitSearchIntoTerms(terms);
                _.forEach(splitTerms, (term) => {

                    let termParts = SmartSearchService.splitTermIntoParts(term);

                    function combineSameSearches(a,b){
                        if (_.isArray(a)) {
                          return a.concat(b);
                        }
                        else {
                            if(a) {
                                return [a,b];
                            }
                        }
                    }

                    // if only a value is provided, search using default keys
                    if (termParts.length === 1) {
                        params = _.merge(params, setDefaults(term), combineSameSearches);
                    } else {
                        // Figure out if this is a search term
                        let root = termParts[0].split(".")[0].replace(/^-/, '');
                        if(_.has($scope.options.actions.GET, root)) {
                            if($scope.options.actions.GET[root].type && $scope.options.actions.GET[root].type === 'field') {
                                params = _.merge(params, qs.encodeParam({term: term, relatedSearchTerm: true}), combineSameSearches);
                            }
                            else {
                                params = _.merge(params, qs.encodeParam({term: term, searchTerm: true}), combineSameSearches);
                            }
                        }
                        // Its not a search term or a related search term
                        else {
                            params = _.merge(params, qs.encodeParam({term: term}), combineSameSearches);
                        }

                    }
                });

                params.page = '1';
                queryset = _.merge(queryset, params, (objectValue, sourceValue, key, object) => {
                    if (object[key] && object[key] !== sourceValue){
                        return [object[key], sourceValue];
                    }
                    else {
                        // // https://lodash.com/docs/3.10.1#merge
                        // If customizer fn returns undefined merging is handled by default _.merge algorithm
                        return undefined;
                    }
                });
                // https://ui-router.github.io/docs/latest/interfaces/params.paramdeclaration.html#dynamic
                // This transition will not reload controllers/resolves/views
                // but will register new $stateParams[$scope.iterator + '_search'] terms
                $state.go('.', {
                    [$scope.iterator + '_search']: queryset });
                qs.search(path, queryset).then((res) => {
                    $scope.dataset = res.data;
                    $scope.collection = res.data.results;
                })
                .catch(function() {
                    $scope.revertSearch(origQueryset);
                });

                $scope.searchTerm = null;
                $scope.searchTags = stripDefaultParams(queryset);
            }
        };

        $scope.revertSearch = function(queryToBeRestored) {
            queryset = queryToBeRestored;
            // https://ui-router.github.io/docs/latest/interfaces/params.paramdeclaration.html#dynamic
            // This transition will not reload controllers/resolves/views
            // but will register new $stateParams[$scope.iterator + '_search'] terms
            $state.go('.', {
                [$scope.iterator + '_search']: queryset });
            qs.search(path, queryset).then((res) => {
                $scope.dataset = res.data;
                $scope.collection = res.data.results;
            });

            $scope.searchTerm = null;
            $scope.searchTags = stripDefaultParams(queryset);
        };
    }
];
